const { Op } = require('sequelize')
const { fail } = require('../../utils/errors')
const { isoDate } = require('../../utils/security')
const { pagination } = require('../../utils/businessValidation')
const {
  createPrecargaRecepcionService,
} = require('./precarga-recepcion.service')

function createPrecargaReadService({ db, wms }) {
  const reception = createPrecargaRecepcionService({ db, wms })
  const {
    Solicitud,
    Precarga,
    PrecargaLote,
    PrecargaDetalle,
    SolicitudRevision,
    Cliente,
    Actor,
    ProductoEquivalencia,
    ComandoIdempotente,
    DecisionSolicitud,
    Programacion,
  } = db.models
  async function summaries(rows, internal) {
    if (!rows.length) return []
    const where = { solicitud_id: { [Op.in]: rows.map((row) => row.id) } }
    const [headers, lots, counts, clients, actors, commands, schedules] =
      await Promise.all([
        Precarga.findAll({ where }),
        PrecargaLote.findAll({ where, order: [['id', 'ASC']] }),
        PrecargaDetalle.findAll({
          where,
          attributes: ['solicitud_id', [db.fn('COUNT', db.col('id')), 'total']],
          group: ['solicitud_id'],
          raw: true,
        }),
        internal
          ? Cliente.findAll({
              where: { id: { [Op.in]: rows.map((row) => row.cliente_id) } },
            })
          : [],
        Actor.findAll({
          where: {
            id: { [Op.in]: rows.map((row) => row.creado_por_actor_id) },
          },
        }),
        ComandoIdempotente.findAll({
          where: {
            solicitud_id: { [Op.in]: rows.map((row) => row.id) },
            operacion: {
              [Op.in]: ['APROBAR_PRECARGA_WMS', 'CREAR_LOTE_PRECARGA_WMS'],
            },
            estado: 'EN_CURSO',
          },
        }),
        Programacion.findAll({ where, order: [['id', 'DESC']] }),
      ])
    return rows.map((row) => {
      const header = headers.find(
        (item) => String(item.solicitud_id) === String(row.id),
      )
      const lot = lots.find(
        (item) => String(item.solicitud_id) === String(row.id),
      )
      const command = commands.find(
        (item) => String(item.solicitud_id) === String(row.id),
      )
      const plan = command
        ? typeof command.resultado_seguro === 'string'
          ? JSON.parse(command.resultado_seguro)
          : command.resultado_seguro
        : null
      return {
        public_id: row.public_id,
        fecha_programada_at: isoDate(
          schedules.find((item) => String(item.solicitud_id) === String(row.id))
            ?.fecha_solicitada_at,
        ),
        referencia_lote: lot?.referencia_cliente ?? 'Sin referencia',
        wms_lote_id: lot?.wms_lote_id ?? null,
        referencia_contenedor: header?.referencia_contenedor ?? null,
        referencia_transporte: header?.referencia_transporte ?? null,
        total_productos: Number(
          counts.find((item) => String(item.solicitud_id) === String(row.id))
            ?.total ?? 0,
        ),
        estado: row.estado,
        creado_at: isoDate(row.creado_at),
        integracion: plan
          ? {
              estado: plan.lote.estado === 'COLISION' ? 'COLISION' : 'EN_CURSO',
              codigo: plan.lote.payload.Id_lote,
              lineas_confirmadas: plan.lineas.filter(
                (line) => line.estado === 'CONFIRMADO',
              ).length,
              total_lineas: plan.lineas.length,
            }
          : null,
        creado_por:
          actors.find(
            (item) => String(item.id) === String(row.creado_por_actor_id),
          )?.nombre_presentacion ?? 'Usuario del cliente',
        ...(internal
          ? {
              cliente_id: String(row.cliente_id),
              cliente_nombre:
                clients.find(
                  (item) => String(item.id) === String(row.cliente_id),
                )?.nombre_presentacion ?? 'Cliente',
            }
          : {}),
      }
    })
  }
  async function list(query, clientId = null) {
    const { page, limit } = pagination({
      ...(query.page === undefined ? {} : { page: query.page }),
      ...(query.limit === undefined ? {} : { limit: query.limit }),
    })
    const where = {
      tipo: 'PRECARGA',
      ...(clientId
        ? { cliente_id: clientId }
        : query.cliente_id
          ? { cliente_id: query.cliente_id }
          : {}),
      ...(query.estado && query.estado !== 'TODOS'
        ? { estado: query.estado }
        : {}),
    }
    const { count, rows } = await Solicitud.findAndCountAll({
      where,
      order: [['id', 'DESC']],
      limit,
      offset: (page - 1) * limit,
    })
    return {
      total: count,
      page,
      limit,
      data: await reception.enrichList(rows, await summaries(rows, !clientId)),
    }
  }
  async function detail(publicId, clientId = null, stocks = undefined) {
    const request = await Solicitud.findOne({
      where: {
        public_id: publicId,
        tipo: 'PRECARGA',
        ...(clientId ? { cliente_id: clientId } : {}),
      },
    })
    if (!request)
      fail(
        404,
        'PRECARGA_NO_EXISTE',
        'La precarga no existe o no está disponible para tu acceso.',
      )
    const revision = await SolicitudRevision.findOne({
      where: {
        cliente_id: request.cliente_id,
        solicitud_id: request.id,
        numero_revision: request.revision_actual,
      },
    })
    if (!revision)
      fail(
        409,
        'PRECARGA_INCOMPLETA',
        'No está disponible la revisión de esta precarga.',
      )
    const snapshot =
      typeof revision.contenido === 'string'
        ? JSON.parse(revision.contenido)
        : revision.contenido
    const equivalents = snapshot.detalles.length
      ? await ProductoEquivalencia.findAll({
          where: {
            producto_version_id: {
              [Op.in]: snapshot.detalles.map(
                (item) => item.producto_version_id,
              ),
            },
          },
        })
      : []
    const [summary] = await summaries([request], !clientId)
    const decision = await DecisionSolicitud.findOne({
      where: {
        solicitud_id: request.id,
        cliente_id: request.cliente_id,
        numero_revision: request.revision_actual,
      },
    })
    const reviewer = decision
      ? await Actor.findByPk(decision.decidido_por_actor_id)
      : null
    return reception.enrich(
      {
        ...summary,
        revision: revision.numero_revision,
        aprobacion:
          decision?.decision === 'APROBADA'
            ? {
                aprobado_at: isoDate(decision.decidido_at),
                aprobado_por: reviewer?.nombre_presentacion ?? 'Equipo interno',
              }
            : null,
        observacion: snapshot.observacion ?? null,
        detalles: snapshot.detalles.map((item) => ({
          nombre: item.nombre,
          referencia: item.referencia,
          prefijo: item.prefijo ?? null,
          codigo_wms:
            equivalents.find(
              (link) =>
                String(link.producto_version_id) ===
                String(item.producto_version_id),
            )?.wms_producto_id ?? null,
          tipo: item.tipo,
          unidad_medida: item.unidad_medida,
          alto_cm: item.alto_cm,
          ancho_cm: item.ancho_cm,
          largo_cm: item.largo_cm,
          cantidad_declarada: item.cantidad_declarada,
        })),
      },
      request.cliente_id,
      stocks,
    )
  }
  async function byLot(lotId) {
    const lots = await PrecargaLote.findAll({
      where: { wms_lote_id: lotId },
      limit: 2,
    })
    if (!lots.length) return null
    if (lots.length !== 1)
      fail(
        409,
        'LOTE_DECLARACION_AMBIGUA',
        'No se pudo identificar una única declaración para este lote.',
      )
    const request = await Solicitud.findOne({
      where: {
        id: lots[0].solicitud_id,
        cliente_id: lots[0].cliente_id,
        tipo: 'PRECARGA',
      },
    })
    if (!request)
      fail(
        409,
        'LOTE_DECLARACION_INVALIDA',
        'La declaración del lote no está disponible.',
      )
    return detail(request.public_id)
  }
  return { list, detail, byLot }
}
module.exports = { createPrecargaReadService }
