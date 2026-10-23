const { Op } = require('sequelize')
const { fail } = require('../../utils/errors')
const { bool } = require('../../utils/security')
const { pagination } = require('../../utils/businessValidation')
const { add } = require('./inventario.decimal')
const { normalize } = require('../productos/producto-similitud')
const { object } = require('../../middlewares/validateRequest.middleware')
const { productQuery, lotsQuery } = require('./inventario.filters')
const {
  groupProducts,
  summary,
  filteredProducts,
} = require('./inventario-proyeccion')
function createInventarioService({ db, wms }) {
  const { Cliente, ClienteProducto, ProductoVersion, ProductoEquivalencia } =
    db.models
  async function readRows(auth) {
    const client = await Cliente.findByPk(auth.cliente_id)
    if (
      !client ||
      !bool(client.habilitado) ||
      !bool(client.wms_activo_ultima_validacion)
    )
      fail(
        403,
        'CLIENTE_DESHABILITADO',
        'El cliente no está habilitado para consultar existencias.',
      )
    const stocks = await wms.inventory(client.wms_cliente_id)
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
    const grouped = new Map(),
      seen = new Set()
    for (const stock of stocks) {
      if (stock.inventario_id == null || seen.has(String(stock.inventario_id)))
        fail(
          502,
          'INVENTARIO_WMS_DUPLICADO',
          'No fue posible verificar los registros de inventario en WMS.',
        )
      seen.add(String(stock.inventario_id))
      const key = JSON.stringify([
        stock.producto_id,
        stock.lote_id,
        stock.unidad_medida,
      ])
      const current = grouped.get(key)
      if (current) {
        current.cantidad_actual = add(current.cantidad_actual, stock.cantidad)
        if (
          stock.actualizado_at &&
          (!current.ultimo_movimiento_at ||
            stock.actualizado_at > current.ultimo_movimiento_at)
        )
          current.ultimo_movimiento_at = stock.actualizado_at
      } else {
        const mapping = mappings.find(
          (item) => item.wms_producto_id === stock.producto_id,
        )
        const version =
          mapping &&
          versions.find(
            (item) => String(item.id) === String(mapping.producto_version_id),
          )
        const link =
          version &&
          links.find(
            (item) => String(item.producto_id) === String(version.producto_id),
          )
        grouped.set(key, {
          codigo_wms: stock.producto_id,
          wms_lote_id: stock.lote_id,
          nombre: link?.alias_cliente || version?.nombre || stock.nombre,
          referencia_cliente: version?.referencia ?? null,
          referencia_wms: stock.referencia,
          unidad_medida: stock.unidad_medida,
          cantidad_actual: add('0', stock.cantidad),
          ultimo_movimiento_at: stock.actualizado_at,
        })
      }
    }
    return [...grouped.values()].filter(
      (row) => Number(row.cantidad_actual) !== 0,
    )
  }
  async function list(auth, query = {}) {
    const { buscar, ...paging } = query
    const { page, limit } = pagination(paging)
    const search = normalize(buscar)
    const rows = (await readRows(auth))
      .filter(
        (row) =>
          !search ||
          [
            row.codigo_wms,
            row.nombre,
            row.referencia_cliente,
            row.referencia_wms,
            row.wms_lote_id,
          ].some((value) => normalize(value).includes(search)),
      )
      .sort(
        (a, b) =>
          a.nombre.localeCompare(b.nombre, 'es') ||
          a.wms_lote_id.localeCompare(b.wms_lote_id, 'es'),
      )
    return {
      total: rows.length,
      page,
      limit,
      consultado_at: new Date().toISOString(),
      data: rows.slice((page - 1) * limit, page * limit),
    }
  }
  async function products(auth, query = {}) {
    const clean = object(query, productQuery, 'consulta')
    const { page = 1, limit = 25 } = clean
    // Group all customer stock before filtering/paging: a page never truncates totals.
    const products = groupProducts(await readRows(auth))
    const rows = filteredProducts(products, clean)
    return {
      total: rows.length,
      page,
      limit,
      unidades: [...new Set(products.map((row) => row.unidad_medida))].sort(
        (a, b) => a.localeCompare(b, 'es'),
      ),
      consultado_at: new Date().toISOString(),
      data: rows.slice((page - 1) * limit, page * limit).map(summary),
    }
  }
  async function lots(auth, code, query = {}) {
    const {
      unidad,
      buscar,
      page = 1,
      limit = 25,
    } = object(query, lotsQuery, 'consulta')
    const product = groupProducts(await readRows(auth)).find(
      (row) => row.codigo_wms === code && row.unidad_medida === unidad,
    )
    if (!product)
      fail(
        404,
        'PRODUCTO_SIN_EXISTENCIAS',
        'El producto ya no tiene existencias. Actualiza el inventario.',
      )
    const search = normalize(buscar)
    const rows = product.lotes
      .filter((lot) => !search || normalize(lot.wms_lote_id).includes(search))
      .sort((a, b) =>
        a.wms_lote_id.localeCompare(b.wms_lote_id, 'es', { numeric: true }),
      )
    return {
      producto: summary(product),
      total: rows.length,
      page,
      limit,
      consultado_at: new Date().toISOString(),
      data: rows.slice((page - 1) * limit, page * limit),
    }
  }
  return { list, products, lots }
}
module.exports = { createInventarioService }
