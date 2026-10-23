const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createWms } = require('../src/integrations/wms/wms.client')
const { add } = require('../src/modules/inventario/inventario.decimal')
const { compare } = require('../src/modules/inventario/inventario.decimal')
const {
  createInventarioService,
} = require('../src/modules/inventario/inventario.service')
const config = {
  wms: {
    baseUrl: 'http://wms.invalid',
    timeoutMs: 1000,
    maxResponseBytes: 4096,
    internalServiceKey: 'fixture-sin-valor-real',
  },
}
const stock = {
  Id_inventario: 1,
  Id_lote_producto: 'LP-001',
  Id_lote: 'GEN_001',
  Id_producto: 'YUT001',
  Nombre_Producto: 'Yute de prueba',
  Referencia: 'INTERNA',
  Unidad_de_medida: 'unidades',
  Cantidad_Inventario: 12,
  id_Cliente: 'CLIENTE-A',
  Id_proveedor: null,
  id_ubicacion: 'NO-EXPONER',
  id_bodega: 'NO-EXPONER',
  Nombre_Cliente: 'No propagar',
}
test('Inventario: filtra titularidad exacta y elimina ubicaciones, posiciones y terceros', async () => {
  const calls = []
  const wms = createWms(config, {
    fetchImpl: async (url, options) => {
      calls.push({ url, options })
      return Response.json([
        stock,
        { ...stock, id_Cliente: 'CLIENTE-B', Cantidad_Inventario: 999 },
      ])
    },
  })
  const rows = await wms.inventory('CLIENTE-A')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].cantidad, '12')
  assert.ok(
    !/NO-EXPONER|CLIENTE-B|ubicacion|bodega|Nombre_Cliente/.test(
      JSON.stringify(rows),
    ),
  )
  assert.equal(calls[0].options.method, 'GET')
  assert.equal(calls[0].options.headers.Authorization, undefined)
  assert.equal(
    calls[0].options.headers['x-internal-service-key'],
    config.wms.internalServiceKey,
  )
  assert.equal(calls[0].url, 'http://wms.invalid/api/inventario/resumen')
  await assert.rejects(wms.inventory('../OTRO'), { code: 'DATOS_INVALIDOS' })
})
test('Inventario: cuenta cero, integración ausente y errores se distinguen sin rechazar la sesión del cliente', async () => {
  const fetchStatus = (status, body) =>
    createWms(config, {
      fetchImpl: async () => Response.json(body, { status }),
    })
  assert.deepEqual(
    await fetchStatus(404, { message: 'No se encontró inventario' }).inventory(
      'CLIENTE-A',
    ),
    [],
  )
  for (const status of [401, 403])
    await assert.rejects(fetchStatus(status, {}).inventory('CLIENTE-A'), {
      status: 503,
    })
  await assert.rejects(
    fetchStatus(404, { message: 'Ruta no existe' }).inventory('CLIENTE-A'),
    { status: 502 },
  )
  await assert.rejects(
    fetchStatus(200, [{ ...stock, Id_proveedor: 'PROVEEDOR' }]).inventory(
      'CLIENTE-A',
    ),
    { status: 502 },
  )
  const missing = createWms(
    { wms: { ...config.wms, internalServiceKey: undefined } },
    {
      fetchImpl: async () => {
        throw new Error('No debe llamar a WMS')
      },
    },
  )
  await assert.rejects(missing.inventory('CLIENTE-A'), {
    code: 'WMS_CONSULTA_NO_CONFIGURADA',
  })
})
test('Cantidades WMS se suman como decimales, incluidos exponentes, sin sumar unidades diferentes', () => {
  assert.equal(add('0.1', '0.2'), '0.3')
  assert.equal(add('1e-7', '0.0000002'), '0.0000003')
  assert.equal(add('99999999999999.999999', '0.000001'), '100000000000000')
  assert.equal(add('-1.25', '1.25'), '0')
  assert.throws(() => add('NaN', '1'))
  assert.equal(compare('99999999999999.999999', '99999999999999.999998'), 1)
})

function inventoryFixture(rows) {
  const calls = []
  const service = createInventarioService({
    db: {
      models: {
        Cliente: {
          findByPk: async (id) =>
            id === 'suspended'
              ? { habilitado: false }
              : {
                  id,
                  habilitado: true,
                  wms_activo_ultima_validacion: true,
                  wms_cliente_id: id,
                },
        },
        ClienteProducto: { findAll: async () => [] },
        ProductoVersion: {},
        ProductoEquivalencia: {},
      },
    },
    wms: {
      inventory: async (id) => {
        calls.push(id)
        return id === 'customer-a' ? rows : []
      },
    },
  })
  return { service, calls, auth: { cliente_id: 'customer-a' } }
}
const row = (id, code, lot, quantity, unit = 'unidades') => ({
  inventario_id: id,
  producto_id: code,
  lote_id: lot,
  cantidad: quantity,
  unidad_medida: unit,
  nombre: code === 'YUT001' ? 'Yute medias rosadas' : 'Yute de prueba',
  referencia: 'REF-' + code,
  actualizado_at: '2026-10-21T15:00:00.000Z',
})
test('Consolidado suma todos los lotes antes de paginar, sin mezclar unidades ni duplicar posiciones', async () => {
  const rows = Array.from({ length: 26 }, (_, i) =>
    row(i + 1, 'YUT001', 'GEN_' + String(i + 1).padStart(3, '0'), '0.1'),
  )
  rows.push(
    row(50, 'YUT001', 'GEN_001', '0.2'),
    row(51, 'YUT001', 'GEN_KG', '5', 'kg'),
    row(52, 'YUT001', 'GEN_CERO', '0'),
  )
  const { service, auth, calls } = inventoryFixture(rows)
  const result = await service.products(auth, { page: '1', limit: '1' })
  assert.equal(result.total, 2)
  assert.equal(result.data.length, 1)
  const complete = await service.products(auth, { unidad: 'unidades' })
  assert.equal(complete.data[0].cantidad_actual, '2.8')
  assert.equal(complete.data[0].total_lotes, 26)
  assert.equal(
    'lotes' in complete.data[0],
    false,
    'El listado no envía todos los lotes',
  )
  assert.deepEqual(complete.unidades, ['kg', 'unidades'])
  const detail = await service.lots(auth, 'YUT001', {
    unidad: 'unidades',
    page: '2',
    limit: '25',
  })
  assert.equal(detail.total, 26)
  assert.equal(detail.data.length, 1)
  assert.equal(detail.data[0].wms_lote_id, 'GEN_026')
  assert.equal(detail.producto.cantidad_actual, '2.8')
  assert.ok(calls.every((id) => id === auth.cliente_id))
  const legacy = await service.list(auth, { page: '1', limit: '25' })
  assert.equal(
    legacy.total,
    27,
    'El alistamiento conserva su consulta por lote',
  )
  assert.equal(
    legacy.data.find((item) => item.wms_lote_id === 'GEN_001').cantidad_actual,
    '0.3',
  )
})
test('Filtros por campo, unidad y distribución conservan los totales globales al buscar un lote', async () => {
  const { service, auth } = inventoryFixture([
    row(1, 'YUT001', 'GEN_010', '3'),
    row(2, 'YUT001', 'GEN_011', '3'),
    row(3, 'YUT002', 'GEN_010', '1'),
    row(4, 'YUT002', 'GEN_011', '20'),
    row(5, 'YUT003', 'GEN_SOLO', '7', 'kg'),
  ])
  const lots = await service.products(auth, {
    campo: 'lote',
    buscar: 'GEN_010',
    ordenar: 'cantidad_desc',
  })
  assert.equal(lots.total, 2)
  assert.equal(lots.data[0].codigo_wms, 'YUT002')
  assert.equal(lots.data[0].cantidad_actual, '21')
  assert.equal(lots.data[0].total_lotes, 2)
  assert.equal(
    (await service.products(auth, { campo: 'codigo', buscar: 'GEN_010' }))
      .total,
    0,
  )
  assert.equal(
    (
      await service.products(auth, {
        campo: 'producto',
        buscar: 'médias ROSADAS',
      })
    ).total,
    1,
  )
  assert.equal(
    (
      await service.products(auth, {
        campo: 'referencia',
        buscar: 'REF-YUT001',
      })
    ).total,
    1,
  )
  assert.equal(
    (await service.products(auth, { lotes: 'varios', unidad: 'unidades' }))
      .total,
    2,
  )
  assert.equal(
    (await service.products(auth, { lotes: 'uno' })).data[0].codigo_wms,
    'YUT003',
  )
  const detail = await service.lots(auth, 'YUT002', {
    unidad: 'unidades',
    buscar: 'GEN_011',
  })
  assert.equal(detail.total, 1)
  assert.equal(detail.producto.cantidad_actual, '21')
})
test('Paginación consolidada es por producto y filtra antes de cortar la página', async () => {
  const rows = Array.from({ length: 30 }, (_, i) =>
    row(i + 1, 'YUT' + i, 'GEN_' + i, String(i + 1)),
  )
  const { service, auth } = inventoryFixture(rows)
  const first = await service.products(auth, {
    ordenar: 'cantidad_desc',
    limit: '25',
  })
  assert.equal(first.total, 30)
  assert.equal(first.data.length, 25)
  assert.equal(first.data[0].cantidad_actual, '30')
  const second = await service.products(auth, {
    ordenar: 'cantidad_desc',
    page: '2',
    limit: '25',
  })
  assert.equal(second.data.length, 5)
  assert.equal(
    new Set([...first.data, ...second.data].map((item) => item.codigo_wms))
      .size,
    30,
  )
  assert.equal(
    (await service.products(auth, { campo: 'codigo', buscar: 'YUT29' })).data[0]
      .cantidad_actual,
    '30',
  )
})
test('Inventario consolidado conserva aislamiento, rechazo de filtros y errores de integración', async () => {
  const rows = [row(1, 'YUT001', 'GEN_001', '2')]
  const { service, auth } = inventoryFixture(rows)
  assert.equal((await service.products({ cliente_id: 'customer-b' })).total, 0)
  await assert.rejects(
    service.lots({ cliente_id: 'customer-b' }, 'YUT001', {
      unidad: 'unidades',
    }),
    { status: 404 },
  )
  await assert.rejects(service.products({ cliente_id: 'suspended' }), {
    status: 403,
  })
  for (const query of [
    { cliente_id: 'customer-b' },
    { campo: 'SQL' },
    { ordenar: 'invalido' },
    { lotes: 'otros' },
    { unidad: ['kg'] },
    { page: '0' },
  ])
    await assert.rejects(service.products(auth, query), { status: 400 })
  rows.push({ ...rows[0] })
  await assert.rejects(service.products(auth), {
    code: 'INVENTARIO_WMS_DUPLICADO',
  })
})
