const { createHash, randomUUID } = require('node:crypto')
const { fail, AppError } = require('../../utils/errors')
const { freshWriter, assertWriter } = require('../../utils/customerAccess')
const { pagination } = require('../../utils/businessValidation')
const { object } = require('../../middlewares/validateRequest.middleware')
const { body } = require('./operacion.validation')
const { add } = require('../inventario/inventario.decimal')
const { validateLead } = require('./operacion-anticipacion')
const { operatingHours, validateHours } = require('./operacion-horario')
const json = (value) => (typeof value === 'string' ? JSON.parse(value) : value)
const digest = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest()
function createOperacionService({
  db,
  wms,
  config,
  sesiones,
  terminos,
  auditoria,
  logger,
  cambios,
}) {
  const {
    Cliente,
    Solicitud,
    SolicitudRevision,
    Operacion,
    Programacion,
    ComandoIdempotente,
  } = db.models
  function anticipation() {
    const minutes = config.operations?.leadMinutes
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 10080)
      fail(
        503,
        'ANTICIPACION_NO_CONFIGURADA',
        'No se ha configurado la anticipación de operaciones.',
      )
    return minutes
  }
  async function load(auth, publicId, transaction) {
    const request = await Solicitud.findOne({
      where: {
        public_id: publicId,
        cliente_id: auth.cliente_id,
        tipo: 'ALISTAMIENTO',
      },
      transaction,
    })
    if (!request) fail(404, 'OPERACION_NO_EXISTE', 'La operación no existe.')
    const [operation, revision, schedule] = await Promise.all([
      Operacion.findByPk(request.id, { transaction }),
      SolicitudRevision.findOne({
        where: { solicitud_id: request.id, numero_revision: 1 },
        transaction,
      }),
      Programacion.findOne({ where: { solicitud_id: request.id, cliente_id: request.cliente_id }, order: [['id','DESC']], transaction }),
    ])
    return { request, operation, schedule, content: json(revision.contenido) }
  }
  async function detail(auth, publicId, cached) {
    const { request, operation, content } = await load(auth, publicId)
    let remote = null,
      unavailable = false
    if (operation.wms_alistamiento_id) {
      try {
        remote = cached
          ? cached.remote
          : await wms.operations().obtain(publicId)
      } catch {
        unavailable = true
      }
      if (!remote) unavailable = true
      if (
        remote &&
        (remote.id_cliente !== content.wms_cliente_id ||
          Number(remote.id_alistamiento) !== operation.wms_alistamiento_id)
      )
        fail(
          502,
          'RESPUESTA_WMS_INVALIDA',
          'No fue posible verificar la operación.',
        )
    }
    const state =
      remote?.estado === 'DESPACHADO'
        ? 'SALIDA_CONFIRMADA'
        : remote?.estado === 'CANCELADO'
          ? 'CANCELADA'
          : remote?.etapa ||
            (operation.wms_alistamiento_id ? null : 'PENDIENTE_WMS')
    const changes = await cambios.summary(request)
    return {
      public_id: request.public_id,
      ...content.customer,
      ...changes.current,
      cambios: changes.cambios,
      total_cambios: changes.total_cambios,
      cambio_pendiente: changes.cambio_pendiente,
      permite_cambios: changes.permite_cambios,
      fecha_original_wms: content.customer.fecha_programada_at,
      creado_at: request.creado_at,
      wms_alistamiento_id: operation.wms_alistamiento_id,
      estado: state,
      estado_no_disponible: unavailable,
    }
  }
  async function list(auth, query) {
    const { page, limit } = pagination(query)
    const where = { cliente_id: auth.cliente_id, tipo: 'ALISTAMIENTO' }
    const { rows, count } = await Solicitud.findAndCountAll({
      where,
      order: [['id', 'DESC']],
      limit,
      offset: (page - 1) * limit,
    })
    const client = await Cliente.findByPk(auth.cliente_id)
    let statuses = []
    if (rows.length) {
      try {
        statuses = await wms.operations().statuses(
          rows.map((row) => row.public_id),
          client.wms_cliente_id,
        )
        if (!Array.isArray(statuses)) statuses = []
      } catch {
        statuses = []
      }
    }
    const data = []
    for (const row of rows)
      data.push(
        await detail(auth, row.public_id, {
          remote:
            statuses.find((item) => item.request_id === row.public_id) || null,
        }),
      )
    return {
      data: data.map(({ detalles, ...row }) => ({
        ...row,
        total_productos: detalles.length,
      })),
      total: count,
      page,
      limit,
      anticipacion_minutos: anticipation(),
      horario_operacion: operatingHours(config),
    }
  }
  async function create(auth, input, context) {
    assertWriter(auth)
    input = object(input, body, 'cuerpo')
    const hash = digest(input)
    const saved = await db.transaction(async (transaction) => {
      const fresh = await freshWriter(auth, transaction, {
        sesiones,
        terminos,
      })
      const client = await Cliente.findByPk(fresh.cliente_id, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      })
      const commandWhere = {
        cliente_id: fresh.cliente_id,
        actor_id: fresh.actor_id,
        operacion: 'AGENDAR_OPERACION',
        clave: input.request_id,
      }
      const previous = await ComandoIdempotente.findOne({
        where: commandWhere,
        transaction,
      })
      if (previous) {
        if (!Buffer.from(previous.peticion_sha256).equals(hash))
          fail(
            409,
            'CLAVE_REUTILIZADA',
            'El envío ya corresponde a otro contenido.',
          )
        return json(previous.resultado_seguro).public_id
      }
      const minutes = anticipation()
      validateLead(input.fecha_programada_at, new Date(), minutes)
      validateHours(input.fecha_programada_at, config)
      await wms.operations().validateClient(client.wms_cliente_id)
      const stocks = await wms.inventory(client.wms_cliente_id)
      const stockByLine = new Map()
      for (const row of stocks) {
        const id = JSON.stringify([row.producto_id, row.lote_id])
        if (!stockByLine.has(id)) stockByLine.set(id, [])
        stockByLine.get(id).push(row)
      }
      const details = input.detalles.map((item) => {
        const own =
          stockByLine.get(
            JSON.stringify([item.codigo_wms, item.wms_lote_id]),
          ) || []
        if (!own.length)
          fail(
            422,
            'PRODUCTO_SIN_EXISTENCIAS',
            'Uno de los productos/lotes no está en tu inventario.',
          )
        if (new Set(own.map((row) => row.unidad_medida)).size !== 1)
          fail(
            502,
            'UNIDAD_STOCK_AMBIGUA',
            'No fue posible verificar la unidad del producto.',
          )
        const total = own.reduce((sum, row) => add(sum, row.cantidad), '0')
        if (add(total, '-' + item.cantidad).startsWith('-'))
          fail(
            409,
            'EXISTENCIAS_INSUFICIENTES',
            'La cantidad supera tus existencias.',
          )
        return {
          ...item,
          nombre: own[0].nombre,
          unidad_medida: own[0].unidad_medida,
        }
      })
      const registeredAt = new Date()
      validateLead(input.fecha_programada_at, registeredAt, minutes)
      const request = await Solicitud.create(
        {
          public_id: randomUUID(),
          cliente_id: fresh.cliente_id,
          tipo: 'ALISTAMIENTO',
          estado: 'ENVIADA',
          creado_por_actor_id: fresh.actor_id,
          observacion_cliente: input.observacion,
          creado_at: registeredAt,
        },
        { transaction },
      )
      await Operacion.create(
        {
          solicitud_id: request.id,
          cliente_id: fresh.cliente_id,
          modalidad: input.modalidad,
          destinatario: input.destinatario,
          direccion_entrega: input.direccion_entrega,
        },
        { transaction },
      )
      const customer = {
        nombre: input.nombre,
        modalidad: input.modalidad,
        fecha_programada_at: new Date(input.fecha_programada_at).toISOString(),
        destinatario: input.destinatario,
        direccion_entrega: input.direccion_entrega,
        observacion: input.observacion,
        detalles: details,
      }
      const content = { customer, wms_cliente_id: client.wms_cliente_id }
      await SolicitudRevision.create(
        {
          cliente_id: fresh.cliente_id,
          solicitud_id: request.id,
          numero_revision: 1,
          contenido: content,
          contenido_sha256: digest(content),
          enviado_por_actor_id: fresh.actor_id,
          enviado_at: new Date(),
        },
        { transaction },
      )
      await Programacion.create(
        {
          cliente_id: fresh.cliente_id,
          solicitud_id: request.id,
          fecha_solicitada_at: new Date(input.fecha_programada_at),
          anticipo_minutos_aplicado: minutes,
          plazo_validado_at: registeredAt,
          creado_por_actor_id: fresh.actor_id,
        },
        { transaction },
      )
      await ComandoIdempotente.create(
        {
          ...commandWhere,
          peticion_sha256: hash,
          estado: 'COMPLETADO',
          solicitud_id: request.id,
          resultado_seguro: { public_id: request.public_id },
          expira_at: new Date(Date.now() + 86400000),
        },
        { transaction },
      )
      await auditoria.record(
        transaction,
        context,
        'OPERACION_AGENDADA',
        'solicitudes',
        request.id,
        {
          clientId: fresh.cliente_id,
          actorId: fresh.actor_id,
          sessionId: fresh.sesion_id,
          solicitudId: request.id,
          detail: {
            dispositivo_id: fresh.dispositivo_id,
            public_id: request.public_id,
            anticipo_minutos: minutes,
          },
        },
      )
      return request.public_id
    })
    return integrate(auth, saved, context)
  }
  async function integrate(auth, publicId, context) {
    assertWriter(auth)
    try {
      await db.transaction(async (transaction) => {
        const fresh = await freshWriter(auth, transaction, {
          sesiones,
          terminos,
        })
        await Cliente.findByPk(fresh.cliente_id, {
          transaction,
          lock: transaction.LOCK.UPDATE,
        })
        const { request, operation, content, schedule } = await load(
          fresh,
          publicId,
          transaction,
        )
        await cambios.canIntegrate(request, transaction)
        if (operation.wms_alistamiento_id) return
        const customer = content.customer
        const body = {
          request_id: publicId,
          id_cliente: content.wms_cliente_id,
          nombre: customer.nombre,
          fecha_programada_at: customer.fecha_programada_at,
          observaciones: [
            customer.modalidad,
            customer.destinatario,
            customer.direccion_entrega,
            customer.observacion,
          ]
            .filter(Boolean)
            .join(' · '),
          items: customer.detalles.map((row) => ({
            id_producto: row.codigo_wms,
            id_lote: row.wms_lote_id,
            cantidad: row.cantidad,
          })),
        }
        const existing = await wms.operations().obtain(publicId)
        if (!existing) {
          validateHours(customer.fecha_programada_at, config)
          // Se conserva el plazo aceptado al registrar; un reintento no reinicia las cinco horas.
          validateLead(customer.fecha_programada_at, schedule?.plazo_validado_at, schedule?.anticipo_minutos_aplicado)
          if (+new Date(customer.fecha_programada_at) <= Date.now())
            fail(422,'RECOGIDA_VENCIDA','La fecha de recogida ya pasó. No se ha creado el alistamiento en Genika.')
        }
        // Incluso si el GET recuperó una respuesta perdida, el POST idempotente compara la huella en WMS.
        const remote = await wms.operations().create(body)
        if (
          remote.request_id !== publicId ||
          remote.id_cliente !== content.wms_cliente_id ||
          !Number.isSafeInteger(remote.id_alistamiento) ||
          remote.id_alistamiento < 1
        )
          fail(
            502,
            'RESPUESTA_WMS_INVALIDA',
            'No fue posible verificar el alistamiento.',
          )
        await operation.update(
          { wms_alistamiento_id: remote.id_alistamiento },
          { transaction },
        )
        await auditoria.record(
          transaction,
          context,
          'ALISTAMIENTO_CREADO_WMS',
          'solicitudes',
          request.id,
          {
            clientId: fresh.cliente_id,
            actorId: fresh.actor_id,
            sessionId: fresh.sesion_id,
            solicitudId: request.id,
            detail: {
              dispositivo_id: fresh.dispositivo_id,
              wms_alistamiento_id: remote.id_alistamiento,
            },
          },
        )
      })
      return await detail(auth, publicId)
    } catch (error) {
      if ([401, 403, 404].includes(error.status)) throw error
      logger?.warn('OPERACION_PENDIENTE_WMS', {
        correlation_id: context?.correlationId,
        codigo: error instanceof AppError ? error.code : 'ERROR_INTERNO',
      })
      return {
        ...(await detail(auth, publicId)),
        integracion_error:
          error instanceof AppError
            ? error.message
            : 'La operación está guardada. Verifica su envío a Genika.',
      }
    }
  }
  return { list, detail, create, integrate }
}
module.exports = { createOperacionService }
