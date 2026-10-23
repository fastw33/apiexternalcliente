const { Op } = require('sequelize')
const { pagination } = require('../../utils/businessValidation')
const { fail } = require('../../utils/errors')
const parse = (value) => (typeof value === 'string' ? JSON.parse(value) : value)
const { operatingHours } = require('./operacion-horario')

function createOperacionInternoService({
  db,
  wms,
  operaciones,
  ingresos,
  cambios,
  config,
}) {
  const { Solicitud, Actor } = db.models
  const includes = [
    {
      association: 'clienteOperacion',
      required: true,
      attributes: ['id', 'nombre_presentacion', 'wms_cliente_id'],
    },
    {
      association: 'operacion',
      required: false,
      attributes: ['wms_alistamiento_id', 'solicitud_id'],
    },
    {
      association: 'revisionInicial',
      required: true,
      attributes: ['contenido'],
    },
  ]
  async function list(query, clientId = null) {
    const { page, limit } = pagination({
      ...(query.page === undefined ? {} : { page: query.page }),
      ...(query.limit === undefined ? {} : { limit: query.limit }),
    })
    const where = {
      tipo: { [Op.in]: ['ALISTAMIENTO', 'PRECARGA'] },
      ...(clientId ? { cliente_id: clientId } : {}),
    }
    const dated = Boolean(query.desde || query.hasta)
    // Programación más reciente, incluidos cambios aprobados. SQL fijo, fechas parametrizadas por ORM.
    const schedule = db.literal(
      '(SELECT COALESCE(p.fecha_confirmada_at,p.fecha_solicitada_at) FROM programaciones p WHERE p.solicitud_id=Solicitud.id AND p.cliente_id=Solicitud.cliente_id ORDER BY p.id DESC LIMIT 1)',
    )
    where[Op.and] = [db.where(schedule, { [Op.ne]: null })]
    if (dated) {
      const from = new Date(query.desde + 'T00:00:00-05:00'),
        until = new Date(query.hasta + 'T00:00:00-05:00')
      if (
        !query.desde ||
        !query.hasta ||
        !Number.isFinite(+from) ||
        !Number.isFinite(+until) ||
        until < from ||
        until - from > 92 * 86400000
      )
        fail(
          400,
          'RANGO_AGENDA_INVALIDO',
          'Selecciona un rango válido de hasta 93 días.',
        )
      where[Op.and].push(
        db.where(schedule, {
          [Op.gte]: from,
          [Op.lt]: new Date(+until + 86400000),
        }),
      )
    }
    if (query.buscar) {
      const pattern = `%${query.buscar}%`
      where[Op.or] = [
        { '$clienteOperacion.nombre_presentacion$': { [Op.like]: pattern } },
        { '$clienteOperacion.wms_cliente_id$': { [Op.like]: pattern } },
        db.where(
          db.fn(
            'JSON_UNQUOTE',
            db.fn(
              'JSON_EXTRACT',
              db.col('revisionInicial.contenido'),
              db.literal("'$.customer.nombre'"),
            ),
          ),
          { [Op.like]: pattern },
        ),
        db.where(
          db.fn(
            'JSON_UNQUOTE',
            db.fn(
              'JSON_EXTRACT',
              db.col('revisionInicial.contenido'),
              db.literal("'$.referencia_lote'"),
            ),
          ),
          { [Op.like]: pattern },
        ),
      ]
    }
    const { rows, count } = await Solicitud.findAndCountAll({
      where,
      include: includes,
      order: dated
        ? [
            [schedule, 'ASC'],
            ['id', 'ASC'],
          ]
        : [['id', 'DESC']],
      limit,
      offset: (page - 1) * limit,
      subQuery: false,
      distinct: true,
    })
    const groups = new Map()
    for (const row of rows) {
      const clientId = row.clienteOperacion.wms_cliente_id
      if (!groups.has(clientId)) groups.set(clientId, [])
      if (row.operacion?.wms_alistamiento_id)
        groups.get(clientId).push(row.public_id)
    }
    const remote = new Map()
    const stocks = new Map()
    await Promise.all(
      [...groups].map(async ([clientId, ids]) => {
        if (!ids.length) return
        try {
          const statuses = await wms.operations().statuses(ids, clientId)
          for (const item of statuses)
            if (item.id_cliente === clientId && ids.includes(item.request_id))
              remote.set(item.request_id, item)
        } catch {
          /* La consulta no inventa estados si WMS está fuera de línea. */
        }
      }),
    )
    await Promise.all(
      [
        ...new Set(
          rows
            .filter((row) => row.tipo === 'PRECARGA')
            .map((row) => row.clienteOperacion.wms_cliente_id),
        ),
      ].map(async (id) => {
        try {
          stocks.set(id, await wms.inventory(id))
        } catch {
          stocks.set(id, null)
        }
      }),
    )
    return {
      page,
      limit,
      total: count,
      ...(clientId
        ? {
            anticipacion_minutos: config.operations.leadMinutes,
            horario_operacion: operatingHours(config),
          }
        : {}),
      data: await Promise.all(
        rows.map(async (row) => {
          if (row.tipo === 'PRECARGA') {
            const data = await ingresos.detail(
              row.public_id,
              clientId,
              stocks.get(row.clienteOperacion.wms_cliente_id),
            )
            const { detalles, ...summary } = data
            return {
              ...summary,
              cliente_nombre: row.clienteOperacion.nombre_presentacion,
              total_productos: detalles.length,
            }
          }
          const changes = await cambios.summary(row)
          const content = {
            ...parse(row.revisionInicial.contenido).customer,
            ...changes.current,
          }
          const state = remote.get(row.public_id)
          const verified =
            state &&
            Number(state.id_alistamiento) === row.operacion.wms_alistamiento_id
          return {
            tipo_operacion: 'RECOGIDA',
            modalidad: 'RECOGIDA',
            public_id: row.public_id,
            cambio_pendiente: changes.cambio_pendiente,
            cliente_nombre: row.clienteOperacion.nombre_presentacion,
            cliente_id: String(row.cliente_id),
            nombre: content.nombre,
            creado_at: row.creado_at,
            fecha_programada_at: content.fecha_programada_at,
            total_productos: content.detalles.length,
            wms_alistamiento_id: row.operacion.wms_alistamiento_id,
            estado: !row.operacion.wms_alistamiento_id
              ? 'PENDIENTE_WMS'
              : !verified
                ? null
                : state.estado === 'DESPACHADO'
                  ? 'SALIDA_CONFIRMADA'
                  : state.estado === 'CANCELADO'
                    ? 'CANCELADA'
                    : state.etapa,
            estado_no_disponible: Boolean(
              row.operacion.wms_alistamiento_id && !verified,
            ),
          }
        }),
      ),
    }
  }
  async function detail(publicId, clientId = null) {
    const row = await Solicitud.findOne({
      where: {
        public_id: publicId,
        tipo: { [Op.in]: ['ALISTAMIENTO', 'PRECARGA'] },
        ...(clientId ? { cliente_id: clientId } : {}),
      },
      include: includes,
    })
    if (!row) fail(404, 'OPERACION_NO_EXISTE', 'La operación no existe.')
    if (row.tipo === 'PRECARGA') return ingresos.detail(publicId, clientId)
    const actor = await Actor.findByPk(row.creado_por_actor_id, {
      attributes: ['nombre_presentacion'],
    })
    return {
      ...(await operaciones.detail({ cliente_id: row.cliente_id }, publicId)),
      tipo_operacion: 'RECOGIDA',
      cliente_nombre: row.clienteOperacion.nombre_presentacion,
      solicitado_por: actor?.nombre_presentacion || 'Usuario del cliente',
    }
  }
  return { list, detail }
}
module.exports = { createOperacionInternoService }
