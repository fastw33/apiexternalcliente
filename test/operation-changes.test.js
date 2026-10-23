const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const {
  validateChange,
} = require('../src/modules/operaciones/operacion-cambio.validation')
const {
  createOperacionCambioService,
} = require('../src/modules/operaciones/operacion-cambio.service')
const { initializeModels } = require('../src/models')
const { Sequelize } = require('sequelize')
const { createWms } = require('../src/integrations/wms/wms.client')
test('Cambios solo aceptan datos del proceso; no productos, clientes ni privilegios', () => {
  const request = {
    request_id: randomUUID(),
    tipo: 'CANCELAR',
    motivo: 'Sin vehículo',
    datos: {},
  }
  assert.deepEqual(validateChange(request), request)
  for (const value of [
    { ...request, cliente_id: 'ajeno' },
    { ...request, datos: { cantidad: '1' } },
    { ...request, tipo: 'SALIDA' },
    {
      ...request,
      tipo: 'CORREGIR',
      datos: {
        nombre: 'x',
        destinatario: null,
        observacion: null,
        detalles: [],
      },
    },
    {
      ...request,
      tipo: 'REPROGRAMAR',
      datos: { fecha_programada_at: '2026-02-30T08:00:00-05:00' },
    },
  ])
    assert.throws(() => validateChange(value), { status: 400 })
})
test('Migración pendiente: no registra el modelo ni consulta tablas nuevas y rechaza escrituras', async () => {
  const db = new Sequelize('sin_conexion', 'fixture', 'fixture', {
    dialect: 'mysql',
    logging: false,
  })
  assert.equal(
    initializeModels(db, { operationChanges: false }).OperacionCambio,
    undefined,
  )
  const service = createOperacionCambioService({
    db,
    config: { operations: { changesEnabled: false } },
  })
  assert.deepEqual(await service.summary({ id: 1, cliente_id: 2 }), {
    current: {},
    cambios: [],
    total_cambios: 0,
    cambio_pendiente: false,
    permite_cambios: false,
  })
  await service.canIntegrate({ id: 1, cliente_id: 2 })
  await assert.rejects(() => service.request({}, 'id', {}, {}), {
    code: 'CAMBIOS_NO_HABILITADOS',
  })
  await assert.rejects(() => service.decide('id', 'id', {}, {}), {
    code: 'CAMBIOS_NO_HABILITADOS',
  })
  await db.close()
})
test('Cancelación usa ruta fija existente y JWT interno; no reenvía el secreto de servicio', async () => {
  const requests = []
  const wms = createWms(
    {
      wms: {
        baseUrl: 'https://wms.invalid',
        timeoutMs: 1000,
        maxResponseBytes: 4096,
        internalServiceKey: 'fixture-privado',
      },
    },
    {
      fetchImpl: async (url, options) => {
        requests.push({ url, options })
        return new Response(JSON.stringify({ estado: 'CANCELADO' }), {
          headers: { 'content-type': 'application/json' },
        })
      },
    },
  )
  await wms
    .operations()
    .cancel(19, 'Bearer jwt-operador', 'Solicitud del cliente')
  assert.equal(requests.length, 1)
  assert.equal(
    requests[0].url,
    'https://wms.invalid/api/alistamientos/19/cancelar',
  )
  assert.equal(requests[0].options.method, 'PATCH')
  assert.equal(requests[0].options.headers.Authorization, 'Bearer jwt-operador')
  assert.equal(requests[0].options.headers['x-internal-service-key'], undefined)
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    motivo: 'Solicitud del cliente',
  })
  for (const id of ['1/otra-ruta', 0, -1])
    assert.throws(() => wms.operations().cancel(id, 'Bearer jwt', 'Motivo'), {
      status: 400,
    })
})
