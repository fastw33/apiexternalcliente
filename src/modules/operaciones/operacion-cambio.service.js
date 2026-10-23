const { Op } = require('sequelize')
const { randomUUID, createHash } = require('node:crypto')
const { fail } = require('../../utils/errors')
const { freshWriter, assertWriter } = require('../../utils/customerAccess')
const {
  validateChange,
  decisionSchema,
} = require('./operacion-cambio.validation')
const { object } = require('../../middlewares/validateRequest.middleware')
const { validateLead } = require('./operacion-anticipacion')
const { validateHours } = require('./operacion-horario')
const parse = (value) => (typeof value === 'string' ? JSON.parse(value) : value)
const openStates = ['SOLICITADO', 'EN_PROCESO', 'CONCILIAR']

function createOperacionCambioService({
  db,
  wms,
  config,
  sesiones,
  terminos,
  actores,
  auditoria,
}) {
  const { Cliente, Solicitud, Operacion, OperacionCambio, Programacion } =
    db.models
  const enabled = Boolean(OperacionCambio && config.operations.changesEnabled)
  const requireEnabled = () => {
    if (!enabled)
      fail(
        503,
        'CAMBIOS_NO_HABILITADOS',
        'Las solicitudes de cambio todavía no están habilitadas.',
      )
  }
  const view = (row) => ({
    public_id: row.public_id,
    tipo: row.tipo,
    estado: row.estado,
    datos: parse(row.datos),
    motivo: row.motivo,
    creado_at: row.creado_at,
    decidido_at: row.decidido_at,
    motivo_decision: row.motivo_decision,
  })
  async function summary(request) {
    if (!enabled)
      return {
        current: {},
        cambios: [],
        total_cambios: 0,
        cambio_pendiente: false,
        permite_cambios: false,
      }
    const rows = await OperacionCambio.findAll({
      where: { solicitud_id: request.id, cliente_id: request.cliente_id },
      order: [['id', 'ASC']],
    })
    const applied = rows.filter((row) => row.estado === 'APLICADO'),
      current = {}
    for (const row of applied)
      if (row.tipo !== 'CANCELAR') {
        const { anticipo_minutos, ...data } = parse(row.datos)
        Object.assign(current, data)
      }
    return {
      current,
      permite_cambios: true,
      cambios: rows.slice(-25).reverse().map(view),
      total_cambios: rows.length,
      cambio_pendiente: rows.some((row) => openStates.includes(row.estado)),
    }
  }
  async function canIntegrate(request, transaction) {
    if (!enabled) return
    if (
      request.estado === 'CANCELADA' ||
      (await OperacionCambio.count({
        where: {
          solicitud_id: request.id,
          cliente_id: request.cliente_id,
          tipo: 'CANCELAR',
          estado: { [Op.in]: openStates },
        },
        transaction,
      }))
    )
      fail(
        409,
        'CANCELACION_PENDIENTE',
        'La operación tiene una cancelación registrada; no se reenviará a Genika.',
      )
  }
  async function request(auth, publicId, value, context) {
    requireEnabled()
    assertWriter(auth)
    const input = validateChange(value),
      hash = createHash('sha256').update(JSON.stringify(input)).digest()
    await db.transaction(async (transaction) => {
      const fresh = await freshWriter(auth, transaction, { sesiones, terminos })
      await Cliente.findByPk(fresh.cliente_id, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      })
      const order = await Solicitud.findOne({
        where: {
          public_id: publicId,
          cliente_id: fresh.cliente_id,
          tipo: 'ALISTAMIENTO',
        },
        transaction,
        lock: transaction.LOCK.UPDATE,
      })
      if (!order) fail(404, 'OPERACION_NO_EXISTE', 'La operación no existe.')
      const old = await OperacionCambio.findOne({
        where: {
          cliente_id: fresh.cliente_id,
          creado_por_actor_id: fresh.actor_id,
          request_id: input.request_id,
        },
        transaction,
      })
      if (old) {
        if (
          String(old.solicitud_id) !== String(order.id) ||
          !Buffer.from(old.peticion_sha256).equals(hash)
        )
          fail(
            409,
            'CLAVE_REUTILIZADA',
            'Este envío corresponde a otro cambio.',
          )
        return
      }
      if (['CANCELADA', 'CERRADA'].includes(order.estado))
        fail(409, 'OPERACION_CERRADA', 'La operación ya fue cerrada.')
      const client = await Cliente.findByPk(fresh.cliente_id, { transaction })
      const remote = await wms.operations().obtain(publicId)
      if (remote && remote.id_cliente !== client.wms_cliente_id)
        fail(
          502,
          'OPERACION_NO_VERIFICADA',
          'No se pudo verificar la operación.',
        )
      if (remote && remote.estado !== 'ABIERTO')
        fail(409, 'OPERACION_CERRADA', 'La operación ya fue cerrada en Genika.')
      if (
        await OperacionCambio.count({
          where: {
            cliente_id: fresh.cliente_id,
            solicitud_id: order.id,
            estado: { [Op.in]: openStates },
          },
          transaction,
        })
      )
        fail(
          409,
          'CAMBIO_PENDIENTE',
          'Ya tienes un cambio pendiente de revisión.',
        )
      if (input.tipo === 'REPROGRAMAR') {
        validateLead(
          input.datos.fecha_programada_at,
          new Date(),
          config.operations.leadMinutes,
        )
        validateHours(input.datos.fecha_programada_at, config)
      }
      const row = await OperacionCambio.create(
        {
          public_id: randomUUID(),
          request_id: input.request_id,
          cliente_id: fresh.cliente_id,
          solicitud_id: order.id,
          tipo: input.tipo,
          estado: 'SOLICITADO',
          datos:
            input.tipo === 'REPROGRAMAR'
              ? {
                  ...input.datos,
                  anticipo_minutos: config.operations.leadMinutes,
                }
              : input.datos,
          motivo: input.motivo,
          peticion_sha256: hash,
          creado_por_actor_id: fresh.actor_id,
        },
        { transaction },
      )
      await auditoria.record(
        transaction,
        context,
        'CAMBIO_OPERACION_SOLICITADO',
        'operacion_cambios',
        row.id,
        {
          clientId: fresh.cliente_id,
          actorId: fresh.actor_id,
          sessionId: fresh.sesion_id,
          solicitudId: order.id,
          detail: {
            tipo: input.tipo,
            dispositivo_id: fresh.dispositivo_id,
            public_id: row.public_id,
          },
        },
      )
    })
  }
  async function decide(publicId, changeId, input, identity, context) {
    requireEnabled()
    input = object(input, decisionSchema, 'cuerpo')
    let work = null
    await db.transaction(async (transaction) => {
      const initial = await Solicitud.findOne({
        where: { public_id: publicId, tipo: 'ALISTAMIENTO' },
        transaction,
      })
      if (!initial) fail(404, 'OPERACION_NO_EXISTE', 'La operación no existe.')
      const client = await Cliente.findByPk(initial.cliente_id, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      })
      const order = await Solicitud.findByPk(initial.id, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      })
      const change = await OperacionCambio.findOne({
        where: {
          public_id: changeId,
          solicitud_id: order.id,
          cliente_id: order.cliente_id,
        },
        transaction,
        lock: transaction.LOCK.UPDATE,
      })
      if (!change) fail(404, 'CAMBIO_NO_EXISTE', 'El cambio no existe.')
      if (['APLICADO', 'RECHAZADO'].includes(change.estado)) {
        if ((input.decision === 'APLICAR') !== (change.estado === 'APLICADO'))
          fail(409, 'CAMBIO_RESUELTO', 'El cambio ya tiene otra decisión.')
        return
      }
      const actorId = await actores.internal(identity, transaction)
      if (input.decision === 'RECHAZAR') {
        if (change.estado !== 'SOLICITADO')
          fail(
            409,
            'CAMBIO_EN_PROCESO',
            'Primero debe conciliarse el cambio con Genika.',
          )
        if (!input.motivo?.trim())
          fail(400, 'MOTIVO_REQUERIDO', 'Indica el motivo del rechazo.')
        await change.update(
          {
            estado: 'RECHAZADO',
            decidido_por_actor_id: actorId,
            decidido_at: new Date(),
            motivo_decision: input.motivo,
          },
          { transaction },
        )
        await audit(
          transaction,
          context,
          'CAMBIO_OPERACION_RECHAZADO',
          change,
          actorId,
        )
        return
      }
      const remote = await wms.operations().obtain(order.public_id)
      if (!remote || remote.id_cliente !== client.wms_cliente_id)
        fail(
          409,
          'OPERACION_NO_VERIFICADA',
          'Verifica primero la integración de la operación con Genika.',
        )
      const operation = await Operacion.findByPk(order.id, { transaction })
      if (
        operation.wms_alistamiento_id &&
        operation.wms_alistamiento_id !== remote.id_alistamiento
      )
        fail(
          502,
          'OPERACION_NO_VERIFICADA',
          'No se pudo verificar el alistamiento.',
        )
      if (change.tipo === 'CANCELAR') {
        if (remote.estado === 'CANCELADO') {
          await finishCancel(transaction, context, order, change, actorId)
          return
        }
        if (remote.estado !== 'ABIERTO')
          fail(
            409,
            'OPERACION_CERRADA',
            'Una salida confirmada no puede cancelarse desde el portal.',
          )
        if (change.estado !== 'SOLICITADO') {
          await change.update({ estado: 'CONCILIAR' }, { transaction })
          return
        }
        // Confirmar intención antes del envío: una respuesta perdida se consulta, nunca se repite a ciegas.
        await change.update(
          {
            estado: 'EN_PROCESO',
            decidido_por_actor_id: actorId,
            motivo_decision: input.motivo,
          },
          { transaction },
        )
        await audit(
          transaction,
          context,
          'CAMBIO_OPERACION_EN_APLICACION',
          change,
          actorId,
        )
        work = {
          order: order.public_id,
          changeId: change.public_id,
          remoteId: remote.id_alistamiento,
          actorId,
          motivo: change.motivo,
        }
        return
      }
      if (remote.estado !== 'ABIERTO')
        fail(409, 'OPERACION_CERRADA', 'La operación ya fue cerrada en Genika.')
      const data = parse(change.datos)
      if (change.tipo === 'REPROGRAMAR') {
        validateHours(data.fecha_programada_at, config)
        validateLead(
          data.fecha_programada_at,
          change.creado_at,
          data.anticipo_minutos,
        )
        if (+new Date(data.fecha_programada_at) <= Date.now())
          fail(409, 'FECHA_VENCIDA', 'La fecha solicitada ya venció.')
        await Programacion.update(
          { estado: 'REEMPLAZADA' },
          {
            where: {
              solicitud_id: order.id,
              cliente_id: order.cliente_id,
              estado: { [Op.in]: ['SOLICITADA', 'CONFIRMADA'] },
            },
            transaction,
          },
        )
        await Programacion.create(
          {
            cliente_id: order.cliente_id,
            solicitud_id: order.id,
            fecha_solicitada_at: new Date(data.fecha_programada_at),
            fecha_confirmada_at: new Date(data.fecha_programada_at),
            estado: 'CONFIRMADA',
            anticipo_minutos_aplicado: data.anticipo_minutos,
            plazo_validado_at: change.creado_at,
            creado_por_actor_id: change.creado_por_actor_id,
            confirmado_por_actor_id: actorId,
            motivo_cambio: change.motivo,
          },
          { transaction },
        )
      }
      await change.update(
        {
          estado: 'APLICADO',
          decidido_por_actor_id: actorId,
          decidido_at: new Date(),
          motivo_decision: input.motivo,
        },
        { transaction },
      )
      await audit(
        transaction,
        context,
        'CAMBIO_OPERACION_APLICADO',
        change,
        actorId,
      )
    })
    if (work) {
      try {
        await wms
          .operations()
          .cancel(work.remoteId, identity.bearer, work.motivo)
      } catch {
        /* Verificar la respuesta incierta sin repetir la mutación. */
      }
      await db.transaction(async (transaction) => {
        const order = await Solicitud.findOne({
          where: { public_id: work.order },
          transaction,
        })
        await Cliente.findByPk(order.cliente_id, {
          transaction,
          lock: transaction.LOCK.UPDATE,
        })
        const change = await OperacionCambio.findOne({
          where: { public_id: work.changeId },
          transaction,
          lock: transaction.LOCK.UPDATE,
        })
        let remote = null
        try {
          remote = await wms.operations().obtain(work.order)
        } catch {
          /* Queda pendiente de conciliación. */
        }
        const client = await Cliente.findByPk(order.cliente_id, { transaction })
        if (
          remote?.estado === 'CANCELADO' &&
          remote.id_cliente === client.wms_cliente_id &&
          remote.id_alistamiento === work.remoteId
        )
          await finishCancel(transaction, context, order, change, work.actorId)
        else {
          await change.update({ estado: 'CONCILIAR' }, { transaction })
          await audit(
            transaction,
            context,
            'CAMBIO_OPERACION_POR_CONCILIAR',
            change,
            work.actorId,
          )
        }
      })
    }
  }
  async function audit(transaction, context, event, change, actorId) {
    await auditoria.record(
      transaction,
      context,
      event,
      'operacion_cambios',
      change.id,
      {
        clientId: change.cliente_id,
        actorId,
        solicitudId: change.solicitud_id,
        detail: { public_id: change.public_id, tipo: change.tipo },
      },
    )
  }
  async function finishCancel(transaction, context, order, change, actorId) {
    await order.update({ estado: 'CANCELADA' }, { transaction })
    await Programacion.update(
      { estado: 'CANCELADA' },
      {
        where: { solicitud_id: order.id, cliente_id: order.cliente_id },
        transaction,
      },
    )
    await change.update(
      {
        estado: 'APLICADO',
        decidido_por_actor_id: actorId,
        decidido_at: new Date(),
      },
      { transaction },
    )
    await audit(
      transaction,
      context,
      'CAMBIO_OPERACION_APLICADO',
      change,
      actorId,
    )
  }
  return { request, decide, summary, canIntegrate }
}
module.exports = { createOperacionCambioService }
