const { Op } = require('sequelize')
const { fail } = require('../../utils/errors')
const { bool } = require('../../utils/security')
const { pagination } = require('../../utils/businessValidation')
const { normalize } = require('../productos/producto-similitud')

function createMovimientoService({ db, wms }) {
  const { Cliente, ClienteProducto, ProductoVersion, ProductoEquivalencia } =
    db.models
  async function list(auth, query = {}) {
    const { buscar, tipo, desde, hasta, ...paging } = query
    const { page, limit } = pagination(paging)
    if (desde && hasta && desde > hasta)
      fail(
        400,
        'RANGO_FECHAS_INVALIDO',
        'La fecha inicial debe ser anterior o igual a la final.',
      )
    const client = await Cliente.findByPk(auth.cliente_id)
    if (
      !client ||
      !bool(client.habilitado) ||
      !bool(client.wms_activo_ultima_validacion)
    )
      fail(
        403,
        'CLIENTE_DESHABILITADO',
        'El cliente no está habilitado para consultar movimientos.',
      )
    const history = await wms.movements(client.wms_cliente_id)
    // El catálogo enriquece la referencia; no limita el historial a productos con stock.
    // Se incluyen también los vínculos retirados y las versiones anteriores.
    const links = await ClienteProducto.findAll({
      where: { cliente_id: client.id },
    })
    const versions = links.length
      ? await ProductoVersion.findAll({
          where: {
            producto_id: { [Op.in]: links.map((link) => link.producto_id) },
          },
        })
      : []
    const mappings = versions.length
      ? await ProductoEquivalencia.findAll({
          where: {
            producto_version_id: {
              [Op.in]: versions.map((version) => version.id),
            },
          },
        })
      : []
    const versionById = new Map(
      versions.map((version) => [String(version.id), version]),
    )
    const referenceByCode = new Map()
    for (const mapping of mappings) {
      const version = versionById.get(String(mapping.producto_version_id))
      const previous = referenceByCode.get(mapping.wms_producto_id)
      if (version && (!previous || BigInt(version.id) > BigInt(previous.id)))
        referenceByCode.set(mapping.wms_producto_id, version)
    }
    const search = normalize(buscar)
    const start = desde ? Date.parse(desde + 'T00:00:00-05:00') : -Infinity
    const end = hasta
      ? Date.parse(hasta + 'T00:00:00-05:00') + 86400000
      : Infinity
    const rows = history
      .map((row) => ({
        ...row,
        referencia_cliente:
          referenceByCode.get(row.codigo_wms)?.referencia ?? null,
      }))
      .filter(
        (row) =>
          (!tipo || row.tipo === tipo) &&
          Date.parse(row.fecha) >= start &&
          Date.parse(row.fecha) < end &&
          (!search ||
            [
              row.codigo_wms,
              row.nombre,
              row.referencia_wms,
              row.referencia_cliente,
              row.wms_lote_id,
            ].some((value) => normalize(value).includes(search))),
      )
      .sort(
        (a, b) =>
          Date.parse(b.fecha) - Date.parse(a.fecha) ||
          (BigInt(a.id) < BigInt(b.id)
            ? 1
            : BigInt(a.id) > BigInt(b.id)
              ? -1
              : 0),
      )
    return {
      data: rows.slice((page - 1) * limit, page * limit),
      total: rows.length,
      page,
      limit,
      consultado_at: new Date().toISOString(),
    }
  }
  return { list }
}
module.exports = { createMovimientoService }
