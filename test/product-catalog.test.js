const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  fingerprint,
  matches,
  similarity,
} = require('../src/modules/productos/producto-similitud')
const { createWms } = require('../src/integrations/wms/wms.client')
const remote = {
  Id_producto: 'CAJ001',
  Nombre: 'Caja plastica',
  Referencia: 'ABC 1',
  Tipo: 'Bodega',
  Unidad_de_medida: 'unidades',
  Alto: 1,
  Ancho: 2,
  Largo: 3,
}
const input = {
  prefijo: 'CAJ',
  nombre: ' Caja PLÁSTICA ',
  referencia: 'ABC-1',
  tipo: 'Bodega',
  unidad_medida: 'unidades',
  alto_cm: '1.0000',
  ancho_cm: '2',
  largo_cm: '3',
}
test('Similitud distingue ficha idéntica de parecida y no ignora dimensiones ni unidad', () => {
  assert.equal(matches(input, [remote])[0].exacta, true)
  for (const diff of [
    { alto_cm: '2' },
    { unidad_medida: 'kilos' },
    { referencia: 'ABC2' },
    { prefijo: 'PAL' },
  ]) {
    assert.equal(matches({ ...input, ...diff }, [remote])[0].exacta, false)
    assert.notEqual(fingerprint(input), fingerprint({ ...input, ...diff }))
  }
  assert.ok(similarity('yute rosado', 'yutes rosados') >= 0.6)
  assert.equal(similarity('', ''), 0)
  assert.equal(
    matches({ nombre: 'Bulto café', referencia: 'OTRA' }, [remote]).length,
    0,
  )
})
test('Conexión automática limita catálogo a Bodega y sus escrituras a producto/lote; no propaga el secreto', async () => {
  const calls = [],
    key = 'clave-fixture-sin-valor-real'
  const wms = createWms(
    {
      wms: {
        baseUrl: 'http://fixture.invalid',
        timeoutMs: 1000,
        maxResponseBytes: 4096,
        internalServiceKey: key,
      },
    },
    {
      fetchImpl: async (url, options) => {
        calls.push({ url, options })
        if (url.endsWith('/api/producto') && options.method === 'GET')
          return Response.json([
            remote,
            { ...remote, Id_producto: 'RS001', Tipo: 'RS' },
          ])
        if (url.endsWith('/api/producto/RS001'))
          return Response.json({ ...remote, Id_producto: 'RS001', Tipo: 'RS' })
        if (url.includes('/api/lote/'))
          return Response.json({ message: 'No existe' }, { status: 404 })
        return Response.json(remote)
      },
    },
  )
  const catalog = wms.products(),
    loads = wms.preloads()
  assert.deepEqual(
    (await catalog.listProducts()).map((row) => row.Id_producto),
    ['CAJ001'],
  )
  await assert.rejects(catalog.getProduct('RS001'), { status: 404 })
  const before = calls.length
  assert.throws(() => catalog.createProduct({ ...remote, Tipo: 'RS' }), {
    status: 400,
  })
  assert.equal(calls.length, before)
  await catalog.createProduct(remote)
  await loads.createLot({ Id_lote: 'GEN_001', Comentarios: 'Fixture' })
  await loads.createLotProduct({
    id_lote: 'GEN_001',
    id_producto: 'CAJ001',
    id_Cliente: 'fixture',
    Cantidad: '1',
  })
  assert.equal(await loads.getLot('GEN_404'), null)
  assert.equal(loads.createProduct, undefined)
  assert.equal(catalog.createLot, undefined)
  assert.ok(
    calls.every(
      (call) =>
        call.options.headers['x-internal-service-key'] === key &&
        !call.options.headers.Authorization,
    ),
  )
  assert.deepEqual(
    calls
      .filter((call) => call.options.method === 'POST')
      .map((call) => new URL(call.url).pathname),
    ['/api/producto', '/api/lote', '/api/lote-producto'],
  )
  assert.ok(!JSON.stringify(await catalog.listProducts()).includes(key))
})
