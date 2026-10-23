const { fail } = require('../../utils/errors')
const { nextCode } = require('../productos/producto-wms')
const { add } = require('../inventario/inventario.decimal')
function decimal(value) {
  const match = /^(\d{1,14})(?:\.(\d{1,6}))?$/.exec(String(value))
  if (!match)
    fail(
      409,
      'CANTIDAD_WMS_INVALIDA',
      'WMS no devolvió una cantidad conciliable.',
    )
  return BigInt(match[1]) * 1000000n + BigInt((match[2] || '').padEnd(6, '0'))
}
function wmsQuantity(value) {
  const number = Number(value)
  if (
    !Number.isFinite(number) ||
    number <= 0 ||
    decimal(value) !== decimal(String(number))
  )
    fail(
      409,
      'PRECISION_WMS_INSUFICIENTE',
      'La cantidad declarada supera la precisión admitida por WMS. Revisa esa línea antes de crear el lote.',
    )
  return String(value)
}
function groupLotLines(lines) {
  const grouped = new Map()
  for (const line of lines) {
    const key = JSON.stringify([line.id_producto, line.id_Cliente])
    const previous = grouped.get(key)
    if (previous && previous.unidad !== line.unidad)
      fail(
        409,
        'UNIDADES_WMS_DIFERENTES',
        'Las referencias del mismo producto deben usar la misma unidad de medida para crear el lote.',
      )
    grouped.set(key, {
      ...line,
      Cantidad: previous
        ? wmsQuantity(add(previous.Cantidad, wmsQuantity(line.Cantidad)))
        : wmsQuantity(line.Cantidad),
    })
  }
  return [...grouped.values()]
}
const nextLot = (lots) =>
  nextCode(
    'GEN_',
    lots.map((lot) => ({ Id_producto: lot.Id_lote })),
  )
function sameLine(expected, remote) {
  return (
    remote.id_lote === expected.id_lote &&
    remote.id_producto === expected.id_producto &&
    remote.id_cliente === expected.id_Cliente &&
    !remote.id_proveedor &&
    decimal(remote.Cantidad) === decimal(expected.Cantidad)
  )
}
module.exports = { decimal, wmsQuantity, groupLotLines, nextLot, sameLine }
