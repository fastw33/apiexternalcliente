const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  decimal,
  wmsQuantity,
  groupLotLines,
  nextLot,
  sameLine,
} = require('../src/modules/precargas/precarga-wms')
const { createWms } = require('../src/integrations/wms/wms.client')

test('Precarga agrupa referencias del mismo producto y cliente con suma decimal exacta', () => {
  const line = {
    id_producto: 'YUT001',
    id_Cliente: 'CLIENTE',
    unidad: 'unidades',
    Cantidad: '0.1',
  }
  const input = [
    line,
    { ...line, id_producto: 'YUT002', Cantidad: '4' },
    { ...line, Cantidad: '0.2' },
  ]
  assert.deepEqual(groupLotLines(input), [
    { ...line, Cantidad: '0.3' },
    { ...line, id_producto: 'YUT002', Cantidad: '4' },
  ])
  assert.equal(input[0].Cantidad, '0.1')
  assert.equal(
    groupLotLines([{ ...line, Cantidad: '2.000000' }])[0].Cantidad,
    '2.000000',
  )
  assert.equal(groupLotLines([line, { ...line, id_Cliente: 'OTRO' }]).length, 2)
  assert.throws(() => groupLotLines([line, { ...line, unidad: 'kilos' }]), {
    code: 'UNIDADES_WMS_DIFERENTES',
  })
  assert.throws(() =>
    groupLotLines([
      { ...line, Cantidad: '99999999999999' },
      { ...line, Cantidad: '1' },
    ]),
  )
})
test('Precarga: cantidades exactas y conciliación por lote, producto, cliente y cantidad', () => {
  assert.equal(decimal('12.000001'), 12000001n)
  assert.equal(wmsQuantity('12.000001'), '12.000001')
  assert.throws(() => wmsQuantity('99999999999999.999999'))
  assert.equal(
    nextLot([{ Id_lote: 'GEN_009' }, { Id_lote: 'GEN_77x' }]),
    'GEN_010',
  )
  const expected = {
    id_lote: 'GEN_010',
    id_producto: 'YUT001',
    id_Cliente: 'CLIENTE',
    Cantidad: '12.000001',
  }
  const row = {
    id_lote: 'GEN_010',
    id_producto: 'YUT001',
    id_cliente: 'CLIENTE',
    Cantidad: 12.000001,
  }
  assert.ok(sameLine(expected, row))
  for (const diff of [
    { id_cliente: 'OTRO' },
    { id_lote: 'GEN_011' },
    { id_producto: 'CAJ001' },
    { Cantidad: 12 },
    { id_proveedor: 'PROVEEDOR' },
  ])
    assert.equal(sameLine(expected, { ...row, ...diff }), false)
})
test('Adaptador de lotes usa endpoints existentes y limita la respuesta a la ficha y líneas del lote', async () => {
  const config = {
    wms: {
      baseUrl: 'http://wms.invalid',
      timeoutMs: 1000,
      maxResponseBytes: 4096,
    },
  }
  const calls = []
  const lot = {
    Id_lote: 'GEN_010',
    Comentarios: 'Marcador de precarga',
    pdf_generado: 'privado',
  }
  const row = {
    id_lote_producto: 'LP-00001',
    id_lote: 'GEN_010',
    id_producto: 'YUT001',
    id_Cliente: 'CLIENTE',
    id_cliente: 'CLIENTE',
    Cantidad: 12,
    Cliente: { Nombre: 'No propagar' },
  }
  const wms = createWms(config, {
    fetchImpl: async (url, options) => {
      calls.push({ url, options })
      return Response.json(
        url.includes('lote-producto')
          ? [row, { ...row, id_lote: 'OTRO' }]
          : options.method === 'GET' && url.endsWith('/lote')
            ? [lot]
            : lot,
      )
    },
  })
  const token = 'Bearer fixture-sin-valor-real'
  assert.deepEqual(await wms.listLots(token), [{ Id_lote: 'GEN_010' }])
  assert.deepEqual(await wms.getLot('GEN_010', token), {
    Id_lote: 'GEN_010',
    Comentarios: lot.Comentarios,
  })
  const rows = await wms.listLotProducts('GEN_010', token)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].id_cliente, 'CLIENTE')
  assert.equal(rows[0].Cliente, undefined)
  await wms.createLot(
    { Id_lote: 'GEN_010', Comentarios: lot.Comentarios },
    token,
  )
  await wms.createLotProduct(
    {
      id_lote: 'GEN_010',
      id_Cliente: 'CLIENTE',
      id_producto: 'YUT001',
      Cantidad: '12',
    },
    token,
  )
  assert.ok(
    calls.every(
      (call) =>
        call.options.headers.Authorization === token &&
        call.options.redirect === 'error',
    ),
  )
  assert.equal(calls.filter((call) => call.options.method === 'POST').length, 2)
  const bad = createWms(config, {
    fetchImpl: async () => Response.json([{ ...row, id_cliente: 'OTRO' }]),
  })
  await assert.rejects(bad.listLotProducts('GEN_010', token), {
    code: 'WMS_RESPUESTA_INVALIDA',
  })
})
