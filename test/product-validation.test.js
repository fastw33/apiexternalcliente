const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  nextCode,
  sameProduct,
  productPayload,
} = require('../src/modules/productos/producto-wms')
const { createWms } = require('../src/integrations/wms/wms.client')
const version = {
  prefijo: 'YUT',
  nombre: 'Yute prueba',
  referencia: 'Referencia',
  tipo: 'Bodega',
  unidad_medida: 'unidades',
  alto_cm: '1.0000',
  ancho_cm: '2.5000',
  largo_cm: '0.0000',
}
const product = productPayload(version, 'YUT001')
test('Consecutivos por prefijo exacto sin truncar números ni confundir prefijos RS', () => {
  assert.equal(nextCode('YUT', []), 'YUT001')
  assert.equal(
    nextCode('YUT', [
      { Id_producto: 'YUT009' },
      { Id_producto: 'YUT099a' },
      { Id_producto: 'CAJ999' },
    ]),
    'YUT010'
  )
  assert.equal(nextCode('YUT', [{ Id_producto: 'YUT999' }]), 'YUT1000')
  assert.equal(
    nextCode('RS-W1-L', [
      { Id_producto: 'RS-W1-L005' },
      { Id_producto: 'RS-W1-LX999' },
    ]),
    'RS-W1-L006'
  )
  assert.equal(
    nextCode('YUT', [{ Id_producto: 'YUT9007199254740993' }]),
    'YUT9007199254740994'
  )
})
test('La verificación del resultado de CREAR compara toda la ficha y su prefijo', () => {
  assert.ok(sameProduct(version, { ...product, Alto: '1', Ancho: '2.5' }))
  for (const changed of [
    { Nombre: 'Otro' },
    { Referencia: 'Otra' },
    { Alto: 2 },
    { Tipo: 'RS' },
    { Unidad_de_medida: 'kilos' },
    { Id_producto: 'CAJ001' },
    { Id_producto: 'YUT001a' },
  ]) {
    assert.equal(sameProduct(version, { ...product, ...changed }), false)
  }
  assert.equal(sameProduct(version, null), false)
})
const config = {
  wms: {
    baseUrl: 'http://wms.invalid',
    timeoutMs: 1000,
    maxResponseBytes: 4096,
  },
}
test('Adaptador usa contratos existentes, reenvía JWT y no propaga otros campos WMS', async () => {
  const calls = []
  const wms = createWms(config, {
    fetchImpl: async (url, options) => {
      calls.push({ url, options })
      const data = url.includes('/prefijo')
        ? { data: [{ prefijo: 'YUT', tipo: 'BODEGA_GENERICO', activo: true }] }
        : url.endsWith('/api/producto') && options.method === 'GET'
          ? [{ ...product, secreto: 'no propagar' }]
          : product
      return Response.json(data)
    },
  })
  const token = 'Bearer fixture-sin-valor-real'
  assert.deepEqual(await wms.listProducts(token), [product])
  assert.deepEqual(await wms.createProduct(product, token), product)
  assert.deepEqual(await wms.getProduct('YUT001', token), product)
  await wms.validateProductPrefix('YUT', 'Bodega', token)
  await assert.rejects(wms.validateProductPrefix('YUT', 'RS', token), {
    code: 'PREFIJO_WMS_NO_DISPONIBLE',
  })
  assert.ok(
    calls.every(
      call =>
        call.options.headers.Authorization === token &&
        call.options.redirect === 'error'
    )
  )
  assert.equal(calls.filter(call => call.options.method === 'POST').length, 1)
  assert.deepEqual(JSON.parse(calls[1].options.body), product)
})
test('Adaptador rechaza identidad equivocada, datos inválidos y errores sin filtrar mensajes remotos', async () => {
  for (const [body, code] of [
    [{ ...product, Id_producto: 'YUT002' }, 'WMS_RESPUESTA_INVALIDA'],
    [{ ...product, Alto: -1 }, 'WMS_RESPUESTA_INVALIDA'],
  ]) {
    const wms = createWms(config, {
      fetchImpl: async () => Response.json(body),
    })
    await assert.rejects(wms.getProduct('YUT001', 'Bearer fixture'), { code })
  }
  for (const [status, code] of [
    [401, 'WMS_SESION_RECHAZADA'],
    [403, 'WMS_SESION_RECHAZADA'],
    [500, 'WMS_ERROR'],
  ]) {
    const wms = createWms(config, {
      fetchImpl: async () => Response.json({ sql: 'privado' }, { status }),
    })
    await assert.rejects(
      wms.listProducts('Bearer fixture'),
      error => error.code === code && !error.message.includes('privado')
    )
  }
  const missing = createWms(config, {
    fetchImpl: async () => new Response(null, { status: 404 }),
  })
  assert.equal(await missing.getProduct('YUT001', 'Bearer fixture'), null)
})
