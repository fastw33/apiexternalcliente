const { add, compare } = require('./inventario.decimal')
const { normalize } = require('../productos/producto-similitud')
const productKey = (row) => JSON.stringify([row.codigo_wms, row.unidad_medida])
function groupProducts(rows) {
  const products = new Map()
  for (const row of rows) {
    if (compare(row.cantidad_actual, '0') <= 0) continue
    const key = productKey(row)
    if (!products.has(key))
      products.set(key, {
        codigo_wms: row.codigo_wms,
        nombre: row.nombre,
        referencia_cliente: row.referencia_cliente,
        referencia_wms: row.referencia_wms,
        unidad_medida: row.unidad_medida,
        cantidad_actual: '0',
        ultimo_movimiento_at: null,
        lotes: [],
      })
    const product = products.get(key)
    product.cantidad_actual = add(product.cantidad_actual, row.cantidad_actual)
    if (
      row.ultimo_movimiento_at &&
      (!product.ultimo_movimiento_at ||
        row.ultimo_movimiento_at > product.ultimo_movimiento_at)
    )
      product.ultimo_movimiento_at = row.ultimo_movimiento_at
    product.lotes.push({
      wms_lote_id: row.wms_lote_id,
      cantidad_actual: row.cantidad_actual,
      ultimo_movimiento_at: row.ultimo_movimiento_at,
    })
  }
  return [...products.values()]
}
function matches(product, search, field = 'todos') {
  const values = {
    codigo: [product.codigo_wms],
    producto: [product.nombre],
    referencia: [product.referencia_cliente, product.referencia_wms],
    lote: product.lotes.map((lot) => lot.wms_lote_id),
  }
  return (
    !search ||
    (field === 'todos' ? Object.values(values).flat() : values[field]).some(
      (value) => normalize(value).includes(search),
    )
  )
}
function summary(product) {
  const { lotes, ...data } = product
  return { ...data, total_lotes: lotes.length }
}
function filteredProducts(products, query) {
  const search = normalize(query.buscar)
  return products
    .filter(
      (product) =>
        (!query.unidad || product.unidad_medida === query.unidad) &&
        (query.lotes !== 'uno' || product.lotes.length === 1) &&
        (query.lotes !== 'varios' || product.lotes.length > 1) &&
        matches(product, search, query.campo),
    )
    .sort((a, b) => {
      let order = 0
      if (query.ordenar === 'cantidad_desc')
        order = compare(b.cantidad_actual, a.cantidad_actual)
      if (query.ordenar === 'cantidad_asc')
        order = compare(a.cantidad_actual, b.cantidad_actual)
      if (query.ordenar === 'reciente')
        order = (b.ultimo_movimiento_at || '').localeCompare(
          a.ultimo_movimiento_at || '',
        )
      return (
        order ||
        a.nombre.localeCompare(b.nombre, 'es', { numeric: true }) ||
        a.codigo_wms.localeCompare(b.codigo_wms, 'es', { numeric: true }) ||
        a.unidad_medida.localeCompare(b.unidad_medida, 'es')
      )
    })
}
module.exports = { groupProducts, summary, filteredProducts }
