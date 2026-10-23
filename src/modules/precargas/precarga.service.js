const { createHash, randomUUID } = require('node:crypto')
const { fail, AppError, errorType } = require('../../utils/errors')
const { isoDate } = require('../../utils/security')
const { assertWriter, freshWriter } = require('../../utils/customerAccess')
const { preloadBody, pagination } = require('../../utils/businessValidation')
const { object } = require('../../middlewares/validateRequest.middleware')
const { createPrecargaReadService } = require('./precarga-read.service')
const { wmsQuantity } = require('./precarga-wms')
const { validateLead } = require('../operaciones/operacion-anticipacion')
const {
  validateHours,
  operatingHours,
} = require('../operaciones/operacion-horario')

const digest = (value) =>
  createHash('sha256').update(JSON.stringify(value), 'utf8').digest()
const json = (value) => (typeof value === 'string' ? JSON.parse(value) : value)

function createPrecargaService({
  db,
  wms,
  sesiones,
  terminos,
  auditoria,
  lotes,
  logger,
  config,
}) {
  const read = createPrecargaReadService({ db, wms })
  const {
    Solicitud,
    SolicitudRevision,
    Precarga,
    PrecargaLote,
    PrecargaDetalle,
    ComandoIdempotente,
    ClienteProducto,
    Producto,
    ProductoVersion,
    ProductoEquivalencia,
    Programacion,
  } = db.models
  async function list(auth, query) {
    pagination(query)
    return {
      ...(await read.list(query, auth.cliente_id)),
      anticipacion_minutos: config.operations.leadMinutes,
      horario_operacion: operatingHours(config),
    }
  }
  async function create(auth, input, context) {
    assertWriter(auth)
    input = object(input, preloadBody, 'cuerpo')
    const hash = digest(input)
    const saved = await db.transaction(async (transaction) => {
      // El bloqueo de usuario de sesiones.load serializa claves del mismo actor entre dispositivos.
      const fresh = await freshWriter(auth, transaction, {
        sesiones,
        terminos,
      })
      const commandWhere = {
        cliente_id: fresh.cliente_id,
        actor_id: fresh.actor_id,
        operacion: 'ENVIAR_PRECARGA',
        clave: input.request_id,
      }
      const previous = await ComandoIdempotente.findOne({
        where: commandWhere,
        transaction,
        lock: transaction.LOCK.UPDATE,
      })
      if (previous) {
        if (!Buffer.from(previous.peticion_sha256).equals(hash))
          fail(
            409,
            'CLAVE_REUTILIZADA',
            'El identificador de envío ya corresponde a otro contenido.',
          )
        if (previous.estado !== 'COMPLETADO')
          fail(
            409,
            'SOLICITUD_EN_PROCESO',
            'La solicitud está en proceso. Consulta el listado antes de reenviar.',
          )
        return json(previous.resultado_seguro)
      }
      let registeredAt = new Date()
      validateLead(
        input.fecha_programada_at,
        registeredAt,
        config.operations.leadMinutes,
        'el ingreso',
      )
      validateHours(input.fecha_programada_at, config)
      const command = await ComandoIdempotente.create(
        {
          ...commandWhere,
          peticion_sha256: hash,
          expira_at: new Date(Date.now() + 86400000),
        },
        { transaction },
      )
      const details = []
      // Orden estable de bloqueos; la instantánea conserva después el orden del formulario.
      for (const item of [...input.detalles].sort((a, b) =>
        BigInt(a.cliente_producto_id) < BigInt(b.cliente_producto_id) ? -1 : 1,
      )) {
        const link = await ClienteProducto.findOne({
          where: { id: item.cliente_producto_id, cliente_id: fresh.cliente_id },
          transaction,
          lock: transaction.LOCK.UPDATE,
        })
        if (!link || link.estado === 'DESHABILITADO' || link.retirado_at)
          fail(
            422,
            'PRODUCTO_NO_DISPONIBLE',
            'Uno de los productos no está disponible en tu catálogo.',
          )
        const product = await Producto.findByPk(link.producto_id, {
          transaction,
          lock: transaction.LOCK.UPDATE,
        })
        const version = await ProductoVersion.findOne({
          where: { producto_id: link.producto_id },
          order: [['numero_version', 'DESC']],
          transaction,
          lock: transaction.LOCK.UPDATE,
        })
        if (
          !product ||
          product.estado === 'INACTIVO' ||
          !version ||
          version.estado === 'RETIRADA'
        ) {
          fail(
            422,
            'PRODUCTO_NO_DISPONIBLE',
            'Uno de los productos no está disponible en tu catálogo.',
          )
        }
        if (String(version.id) !== item.producto_version_id) {
          fail(
            409,
            'PRODUCTO_ACTUALIZADO',
            'La ficha de un producto cambió. Corrige la solicitud con el catálogo actualizado antes de enviarla.',
          )
        }
        const equivalence = await ProductoEquivalencia.findOne({
          where: { producto_version_id: version.id },
          transaction,
          lock: transaction.LOCK.UPDATE,
        })
        if (
          link.estado !== 'HABILITADO' ||
          product.estado !== 'VALIDADO' ||
          version.estado !== 'HOMOLOGADA' ||
          !equivalence
        )
          fail(
            409,
            'PRODUCTO_PENDIENTE_VALIDACION',
            'Selecciona productos habilitados y sincronizados con Genika para crear el lote.',
          )
        wmsQuantity(item.cantidad_declarada)
        details.push({
          cliente_producto_id: String(link.id),
          producto_id: String(product.id),
          producto_version_id: String(version.id),
          codigo_cliente: link.codigo_cliente,
          prefijo: version.prefijo ?? null,
          nombre: link.alias_cliente || version.nombre,
          referencia: version.referencia,
          tipo: version.tipo,
          unidad_medida: version.unidad_medida,
          alto_cm: String(version.alto_cm),
          ancho_cm: String(version.ancho_cm),
          largo_cm: String(version.largo_cm),
          cantidad_declarada: item.cantidad_declarada,
        })
      }
      registeredAt = new Date()
      validateLead(
        input.fecha_programada_at,
        registeredAt,
        config.operations.leadMinutes,
        'el ingreso',
      )
      const request = await Solicitud.create(
        {
          public_id: randomUUID(),
          cliente_id: fresh.cliente_id,
          tipo: 'PRECARGA',
          estado: 'ENVIADA',
          observacion_cliente: input.observacion,
          creado_por_actor_id: fresh.actor_id,
          creado_at: registeredAt,
        },
        { transaction },
      )
      const common = { cliente_id: fresh.cliente_id, solicitud_id: request.id }
      await Programacion.create(
        {
          ...common,
          fecha_solicitada_at: new Date(input.fecha_programada_at),
          anticipo_minutos_aplicado: config.operations.leadMinutes,
          plazo_validado_at: registeredAt,
          creado_por_actor_id: fresh.actor_id,
        },
        { transaction },
      )
      await Precarga.create(
        {
          ...common,
          referencia_contenedor: input.referencia_contenedor,
          referencia_transporte: input.referencia_transporte,
        },
        { transaction },
      )
      const lot = await PrecargaLote.create(
        { ...common, referencia_cliente: input.referencia_lote },
        { transaction },
      )
      await PrecargaDetalle.bulkCreate(
        details.map((item) => ({
          ...common,
          precarga_lote_id: lot.id,
          cliente_producto_id: item.cliente_producto_id,
          producto_id: item.producto_id,
          producto_version_id: item.producto_version_id,
          cantidad_declarada: item.cantidad_declarada,
        })),
        { transaction, validate: true },
      )
      const snapshot = {
        fecha_programada_at: new Date(input.fecha_programada_at).toISOString(),
        referencia_lote: input.referencia_lote,
        referencia_contenedor: input.referencia_contenedor,
        referencia_transporte: input.referencia_transporte,
        observacion: input.observacion,
        detalles: input.detalles.map((item) =>
          details.find(
            (row) => row.cliente_producto_id === item.cliente_producto_id,
          ),
        ),
      }
      await SolicitudRevision.create(
        {
          ...common,
          numero_revision: 1,
          contenido: snapshot,
          contenido_sha256: digest(snapshot),
          enviado_por_actor_id: fresh.actor_id,
          enviado_at: new Date(),
        },
        { transaction },
      )
      await auditoria.record(
        transaction,
        context,
        'PRECARGA_ENVIADA',
        'solicitud',
        request.id,
        {
          clientId: fresh.cliente_id,
          actorId: fresh.actor_id,
          sessionId: fresh.sesion_id,
          solicitudId: request.id,
          detail: {
            public_id: request.public_id,
            dispositivo_id: fresh.dispositivo_id,
            numero_revision: 1,
          },
        },
      )
      const result = {
        public_id: request.public_id,
        referencia_lote: input.referencia_lote,
        estado: request.estado,
        creado_at: isoDate(request.creado_at),
      }
      await command.update(
        {
          estado: 'COMPLETADO',
          solicitud_id: request.id,
          resultado_seguro: result,
        },
        { transaction },
      )
      return result
    })
    return createLot(auth, saved.public_id, { revision: 1 }, context)
  }
  async function createLot(auth, publicId, input, context) {
    assertWriter(auth)
    // Consultar pertenencia antes de intentar integrar; nunca aceptar un cliente del navegador.
    await read.detail(publicId, auth.cliente_id)
    try {
      return await lotes.createForCustomer(publicId, input, auth, context)
    } catch (error) {
      if ([401, 403, 404].includes(error.status)) throw error
      logger?.warn('PRECARGA_LOTE_PENDIENTE', {
        correlation_id: context?.correlationId,
        cliente_id: String(auth.cliente_id),
        usuario_id: String(auth.id),
        error_tipo: errorType(error),
        codigo: error instanceof AppError ? error.code : 'ERROR_INTERNO',
      })
      return {
        ...(await read.detail(publicId, auth.cliente_id)),
        creacion_error: {
          code:
            error instanceof AppError
              ? error.code
              : 'LOTE_CONFIRMACION_PENDIENTE',
          message:
            error instanceof AppError
              ? error.message
              : 'La precarga está guardada. Verifica la creación del lote desde su detalle.',
        },
      }
    }
  }
  return {
    list,
    create,
    createLot,
    detail: (auth, publicId) => read.detail(publicId, auth.cliente_id),
  }
}
module.exports = { createPrecargaService }
