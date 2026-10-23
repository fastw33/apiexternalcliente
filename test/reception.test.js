const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  receptionProjection,
  createPrecargaRecepcionService,
} = require('../src/modules/precargas/precarga-recepcion.service')
const lines = [
  { codigo_wms: 'CAJ1', cantidad_declarada: '100', unidad_medida: 'unidades' },
  { codigo_wms: 'CAJ2', cantidad_declarada: '50', unidad_medida: 'unidades' },
]
const stock = (id, code, quantity, extra = {}) => ({
  inventario_id: String(id),
  producto_id: code,
  lote_id: 'GEN1',
  unidad_medida: 'unidades',
  cantidad: quantity,
  ...extra,
})
const project = (stocks, items = lines) =>
  receptionProjection(items, stocks, 'GEN1')

test('Estado por presencia actual: ninguno pendiente, algunos parcial, todos confirmado aunque las cantidades sean menores', () => {
  assert.equal(project([]).recepcion.estado, 'PENDIENTE')
  assert.equal(project([stock(1, 'CAJ1', '1')]).recepcion.estado, 'PARCIAL')
  const all = project([stock(1, 'CAJ1', '0.1'), stock(2, 'CAJ2', '0.2')])
  assert.equal(all.recepcion.estado, 'RECIBIDA')
  assert.equal(all.recepcion.fuente, 'INVENTARIO_ACTUAL')
  assert.equal(all.recepcion.productos_en_inventario, 2)
  assert.equal(all.detalles[0].cantidad_en_inventario, '0.1')
  assert.equal(
    project([]).recepcion.estado,
    'PENDIENTE',
    'Sin saldo actual no conserva un estado histórico',
  )
})

test('Agrupa posiciones, ignora otros lotes y productos; saldos cero o negativos no cuentan como presencia', () => {
  const result = project([
    stock(1, 'CAJ1', '0.1'),
    stock(2, 'CAJ1', '0.2'),
    stock(3, 'CAJ2', '0'),
    stock(4, 'CAJ2', '999', { lote_id: 'OTRO' }),
    stock(5, 'EXTRA', '999'),
  ])
  assert.equal(result.recepcion.estado, 'PARCIAL')
  assert.equal(result.detalles[0].cantidad_en_inventario, '0.3')
  assert.equal(result.detalles[1].cantidad_en_inventario, '0')
  assert.equal(
    project([stock(1, 'CAJ1', '-1'), stock(2, 'CAJ2', '0')]).recepcion.estado,
    'PENDIENTE',
  )
  assert.equal(
    project([stock(1, 'CAJ1', '1'), stock(2, 'CAJ1', '-1')]).recepcion.estado,
    'PENDIENTE',
  )
})

test('Lote cerrado como Genika: registros del lote en cero; sin registros queda pendiente y cualquier saldo evita el cierre', () => {
  assert.equal(project([]).recepcion.estado, 'PENDIENTE')
  assert.equal(
    project([stock(1, 'CAJ1', '0'), stock(2, 'CAJ2', '0.000')]).recepcion
      .estado,
    'CERRADA',
  )
  assert.equal(
    project([stock(1, 'CAJ1', '0'), stock(2, 'CAJ2', '0', { lote_id: 'OTRO' })])
      .recepcion.estado,
    'CERRADA',
  )
  assert.equal(
    project([stock(1, 'CAJ1', '0', { lote_id: 'OTRO' })]).recepcion.estado,
    'PENDIENTE',
  )
  assert.notEqual(
    project([stock(1, 'CAJ1', '0'), stock(2, 'EXTRA', '1')]).recepcion.estado,
    'CERRADA',
  )
  assert.equal(
    project([stock(1, 'CAJ1', '1'), stock(2, 'CAJ2', '0')]).recepcion.estado,
    'PARCIAL',
  )
  assert.equal(
    project([stock(1, 'CAJ1', '1'), stock(2, 'CAJ2', '1')]).recepcion.estado,
    'RECIBIDA',
  )
})

test('Referencias externas de una misma ficha cuentan una vez sin duplicar cantidades; datos ambiguos no confirman', () => {
  const result = project([stock(1, 'CAJ1', '3')], [lines[0], lines[0]])
  assert.equal(result.recepcion.estado, 'RECIBIDA')
  assert.equal(result.recepcion.total_productos, 1)
  assert.ok(
    result.detalles.every(
      (row) => row.inventario_compartido && row.cantidad_en_inventario === null,
    ),
  )
  assert.throws(() => project([stock(1, 'CAJ1', '1'), stock(1, 'CAJ1', '1')]), {
    code: 'INVENTARIO_RECEPCION_INVALIDO',
  })
  assert.throws(
    () =>
      project([
        stock(1, 'CAJ1', '1'),
        stock(2, 'CAJ1', '1', { unidad_medida: 'kg' }),
      ]),
    { code: 'UNIDAD_RECEPCION_INVALIDA' },
  )
  assert.throws(() => project([], [{ codigo_wms: null }]), {
    code: 'INVENTARIO_RECEPCION_INVALIDO',
  })
})

test('Consulta inventario del cliente de la base; una caída no se interpreta como inventario vacío', async () => {
  let owner
  const service = createPrecargaRecepcionService({
    db: {
      models: {
        Cliente: {
          findByPk: async (id) => {
            assert.equal(id, '17')
            return { wms_cliente_id: 'real-client' }
          },
        },
      },
    },
    wms: {
      inventory: async (id) => {
        owner = id
        throw new Error('fuera de línea')
      },
      movements: async () => {
        throw new Error('No debe consultar historial')
      },
    },
  })
  const result = await service.enrich(
    { wms_lote_id: 'GEN1', detalles: lines },
    '17',
  )
  assert.equal(owner, 'real-client')
  assert.equal(result.recepcion.estado, 'NO_DISPONIBLE')
  assert.equal(result.detalles[0].cantidad_en_inventario, undefined)
})
