const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createWms } = require('../src/integrations/wms/wms.client')
const {
  movementsForClient,
} = require('../src/integrations/wms/wms-movimientos')
const {
  createMovimientoService,
} = require('../src/modules/movimientos/movimiento.service')
const {
  queryRules,
} = require('../src/modules/movimientos/movimiento.validation')
const { object } = require('../src/middlewares/validateRequest.middleware')
const config = {
  wms: {
    baseUrl: 'http://wms.invalid',
    timeoutMs: 1000,
    maxResponseBytes: 100000,
    internalServiceKey: 'fixture-sin-valor-real',
  },
}
function movement(id, owner = 'A', extra = {}) {
  return {
    id_historial: id,
    id_lote_producto: 'LP-' + id,
    id_producto: 'CAJ001',
    Cantidad: '0.125',
    Movimiento_tipo: 'Entrada',
    Fecha_movimiento: '2026-10-20T05:00:00.000Z',
    Comentario: 'INTERNO-NO-PROPAGAR',
    id_personal: 'PERSONAL-PRIVADO',
    id_ubicacion_origen: 'UBICACION-SECRETA',
    documento_pdf: '/archivo-interno',
    codigo_qr: 'SECRETO',
    Inventario: { id_cliente: 'OTRO', cantidad: 0 },
    operacionRef: { id_cliente: 'OTRO' },
    LoteProducto: {
      id_lote_producto: 'LP-' + id,
      id_lote: 'GEN_' + id,
      id_producto: 'CAJ001',
      id_cliente: owner,
      id_Cliente: owner,
      id_proveedor: null,
      Producto: {
        Id_producto: 'CAJ001',
        Nombre: 'Café en caja',
        Referencia: 'INTERNA',
        Unidad_de_medida: 'unidades',
      },
    },
    ...extra,
  }
}
test('Historial: aislamiento por lote-producto, códigos compartidos y DTO sin datos internos', async () => {
  const calls = []
  const rows = [
    movement(1),
    movement(2, 'B'),
    movement(3, 'A', { Movimiento_tipo: 'Salida' }),
    movement(4, 'B', { operacionRef: { id_cliente: 'A' } }),
    movement(5, 'A', { LoteProducto: null }),
    ...[
      'Re_Organizacion',
      'Transformación',
      'Transformacion',
      'Alistamiento',
    ].map((type, i) => movement(i + 6, 'A', { Movimiento_tipo: type })),
  ]
  const api = createWms(config, {
    fetchImpl: async (url, options) => {
      calls.push({ url, options })
      return Response.json(rows)
    },
  })
  const own = await api.movements('A')
  assert.deepEqual(
    own.map((row) => row.id),
    ['1', '3', '6', '7', '8', '9'],
  )
  assert.deepEqual(
    own.map((row) => row.tipo),
    [
      'ENTRADA',
      'SALIDA',
      'REUBICACION',
      'TRANSFORMACION',
      'TRANSFORMACION',
      'ALISTAMIENTO',
    ],
  )
  assert.equal(own[0].cantidad, '0.125')
  assert.ok(
    !/INTERNO|PRIVADO|SECRETO|id_ubicacion|id_personal|Inventario|operacionRef|documento|cliente/i.test(
      JSON.stringify(own),
    ),
  )
  assert.equal(calls[0].url, 'http://wms.invalid/api/historial/con-lote')
  assert.equal(calls[0].options.method, 'GET')
  assert.equal(calls[0].options.headers.Authorization, undefined)
  assert.equal(
    calls[0].options.headers['x-internal-service-key'],
    config.wms.internalServiceKey,
  )
  assert.deepEqual(movementsForClient(rows, 'SIN-MOVIMIENTOS'), [])
})
test('Historial: rechaza titularidad ambigua, inconsistencias, duplicados y respuestas incompletas', () => {
  const row = movement(1)
  for (const invalid of [
    { ...row, LoteProducto: { ...row.LoteProducto, id_Cliente: 'B' } },
    { ...row, LoteProducto: { ...row.LoteProducto, id_cliente: 'B' } },
    { ...row, LoteProducto: { ...row.LoteProducto, id_proveedor: 'P' } },
    { ...row, LoteProducto: { ...row.LoteProducto, Producto: null } },
    { ...row, id_producto: 'OTRO' },
    { ...row, id_lote_producto: 'OTRO' },
    { ...row, Movimiento_tipo: 'DESCONOCIDO' },
    { ...row, Fecha_movimiento: '2026-10-20 12:00:00' },
    { ...row, Cantidad: -1 },
    { ...row, Cantidad: 'NaN' },
  ])
    assert.throws(() => movementsForClient([invalid], 'A'), { status: 502 })
  assert.throws(() => movementsForClient([row, row], 'A'), { status: 502 })
  assert.throws(() => movementsForClient({ data: [row] }, 'A'), {
    status: 502,
  })
  // Compatibilidad si WMS entrega solo una de sus dos propiedades de titularidad.
  const single = structuredClone(row)
  delete single.LoteProducto.id_Cliente
  assert.equal(movementsForClient([single], 'A').length, 1)
})
test('Historial: fallas WMS no se convierten en historial vacío ni cierran la sesión', async () => {
  for (const status of [401, 403, 404, 500]) {
    const api = createWms(config, {
      fetchImpl: async () => Response.json({}, { status }),
    })
    await assert.rejects(api.movements('A'), {
      status: [401, 403].includes(status) ? 503 : 502,
    })
  }
  const api = createWms(
    { wms: { ...config.wms, maxResponseBytes: 10 } },
    {
      fetchImpl: async () => Response.json([movement(1)]),
    },
  )
  await assert.rejects(api.movements('A'), { code: 'WMS_RESPUESTA_EXCESIVA' })
  const missing = createWms(
    { wms: { ...config.wms, internalServiceKey: '' } },
    {
      fetchImpl: () => assert.fail('No debe consultar sin credencial privada'),
    },
  )
  await assert.rejects(missing.movements('A'), { status: 503 })
  await assert.rejects(missing.movements('../B'), { status: 400 })
})
function serviceFixture(
  history,
  { links = [], versions = [], mappings = [], client = undefined } = {},
) {
  const calls = []
  const service = createMovimientoService({
    db: {
      models: {
        Cliente: {
          findByPk: async (id) => {
            calls.push(['client', id])
            return client === undefined
              ? {
                  id,
                  wms_cliente_id: 'A',
                  habilitado: true,
                  wms_activo_ultima_validacion: true,
                }
              : client
          },
        },
        ClienteProducto: {
          findAll: async ({ where }) => {
            calls.push(['catalog', where])
            return links
          },
        },
        ProductoVersion: { findAll: async () => versions },
        ProductoEquivalencia: { findAll: async () => mappings },
      },
    },
    wms: {
      movements: async (id) => {
        calls.push(['wms', id])
        return history
      },
      inventory: () =>
        assert.fail('La historia no depende del inventario actual'),
    },
  })
  return { service, calls }
}
test('Historial: búsqueda antes de paginar, 25 por página, fechas Colombia inclusivas y orden estable', async () => {
  const rows = Array.from({ length: 60 }, (_, i) => movement(i + 1))
  rows.push(
    movement(61, 'A', { Fecha_movimiento: '2026-10-20T04:59:59.999Z' }),
    movement(62, 'A', {
      Fecha_movimiento: '2026-10-21T04:59:59.999Z',
      Movimiento_tipo: 'Salida',
    }),
    movement(63, 'A', { Fecha_movimiento: '2026-10-21T05:00:00.000Z' }),
  )
  const { service, calls } = serviceFixture(movementsForClient(rows, 'A'))
  const auth = { cliente_id: '13' }
  const result = await service.list(auth, {
    page: '2',
    limit: '25',
    desde: '2026-10-20',
    hasta: '2026-10-20',
  })
  assert.equal(result.total, 61)
  assert.equal(result.data.length, 25)
  assert.equal(result.data[0].id, '36')
  assert.equal((await service.list(auth, { buscar: 'cafe' })).total, 63)
  assert.equal(
    (await service.list(auth, { buscar: 'GEN_63', page: '1' })).data[0].id,
    '63',
  )
  assert.equal((await service.list(auth, { tipo: 'SALIDA' })).total, 1)
  assert.equal((await service.list(auth, { buscar: 'inexistente' })).total, 0)
  assert.deepEqual(calls.slice(0, 3), [
    ['client', '13'],
    ['wms', 'A'],
    ['catalog', { cliente_id: '13' }],
  ])
  await assert.rejects(
    service.list(auth, { desde: '2026-10-21', hasta: '2026-10-20' }),
    { status: 400 },
  )
})
test('Historial: conserva productos retirados y anteriores al portal y busca por referencia externa', async () => {
  const rows = movementsForClient(
    [
      movement(1),
      movement(2, 'A', {
        id_producto: 'LEG001',
        LoteProducto: {
          ...movement(2).LoteProducto,
          id_producto: 'LEG001',
          Producto: {
            ...movement(2).LoteProducto.Producto,
            Id_producto: 'LEG001',
          },
        },
      }),
    ],
    'A',
  )
  const { service } = serviceFixture(rows, {
    links: [{ producto_id: '10', estado: 'RETIRADO' }],
    versions: [
      { id: '3', producto_id: '10', referencia: 'REF-EXT' },
      { id: '2', producto_id: '10', referencia: 'VIEJA' },
    ],
    mappings: [
      { producto_version_id: '3', wms_producto_id: 'CAJ001' },
      { producto_version_id: '2', wms_producto_id: 'CAJ001' },
    ],
  })
  assert.equal((await service.list({ cliente_id: '13' }, {})).total, 2)
  const found = await service.list({ cliente_id: '13' }, { buscar: 'ref-ext' })
  assert.equal(found.total, 1)
  assert.equal(found.data[0].referencia_cliente, 'REF-EXT')
  for (const client of [
    null,
    { habilitado: false },
    { habilitado: true, wms_activo_ultima_validacion: false },
  ]) {
    const fixture = serviceFixture([], { client })
    await assert.rejects(fixture.service.list({ cliente_id: '13' }, {}), {
      status: 403,
    })
    assert.equal(fixture.calls.length, 1)
  }
})
test('Historial: solo filtros declarados, fechas reales, sin elegir cliente ni inyectar consultas', () => {
  for (const query of [
    { cliente_id: 'B' },
    { id_cliente: 'B' },
    { buscar: { $ne: null } },
    { tipo: 'OTRO' },
    { desde: '2026-02-30' },
    { desde: '2026-02-29' },
    { hasta: '2026-10-20T00:00:00Z' },
    { page: '0' },
    { limit: '101' },
  ])
    assert.throws(() => object(query, queryRules, 'consulta'), { status: 400 })
  assert.equal(
    object({ desde: '2024-02-29' }, queryRules, 'consulta').desde,
    '2024-02-29',
  )
})
