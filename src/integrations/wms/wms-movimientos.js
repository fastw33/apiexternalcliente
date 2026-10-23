const { fail } = require('../../utils/errors')

const types = new Map([
  ['Entrada', 'ENTRADA'],
  ['Salida', 'SALIDA'],
  ['Re_Organizacion', 'REUBICACION'],
  ['Transformacion', 'TRANSFORMACION'],
  ['Transformación', 'TRANSFORMACION'],
  ['Alistamiento', 'ALISTAMIENTO'],
])
const text = (value) =>
  typeof value === 'string' &&
  value.trim() &&
  value.length <= 250 &&
  !/[\u0000-\u001f\u007f]/.test(value)
const invalid = () =>
  fail(
    502,
    'MOVIMIENTOS_WMS_INVALIDOS',
    'No fue posible verificar el historial de movimientos en WMS.',
  )

function movementsForClient(rows, clientId) {
  if (!Array.isArray(rows)) invalid()
  const seen = new Set(),
    result = []
  for (const row of rows) {
    const line = row?.LoteProducto
    // Un código compartido nunca demuestra la titularidad de un movimiento.
    if (!line || (line.id_cliente !== clientId && line.id_Cliente !== clientId))
      continue
    if (
      (line.id_cliente != null && line.id_cliente !== clientId) ||
      (line.id_Cliente != null && line.id_Cliente !== clientId) ||
      (line.id_proveedor != null && line.id_proveedor !== '')
    )
      invalid()
    const product = line.Producto
    if (
      !product ||
      ![
        line.id_lote_producto,
        line.id_lote,
        line.id_producto,
        product.Nombre,
        product.Unidad_de_medida,
      ].every(text) ||
      row.id_lote_producto !== line.id_lote_producto ||
      row.id_producto !== line.id_producto ||
      product.Id_producto !== line.id_producto ||
      !/^[1-9][0-9]{0,19}$/.test(String(row.id_historial)) ||
      seen.has(String(row.id_historial)) ||
      !types.has(row.Movimiento_tipo) ||
      !['string', 'number'].includes(typeof row.Cantidad) ||
      String(row.Cantidad).trim() === '' ||
      !Number.isFinite(Number(row.Cantidad)) ||
      Number(row.Cantidad) < 0 ||
      typeof row.Fecha_movimiento !== 'string' ||
      !/(Z|[+-]\d{2}:\d{2})$/.test(row.Fecha_movimiento) ||
      !Number.isFinite(Date.parse(row.Fecha_movimiento))
    )
      invalid()
    seen.add(String(row.id_historial))
    // No propagar comentarios, ubicaciones, personal, QR ni documentos internos.
    result.push({
      id: String(row.id_historial),
      tipo: types.get(row.Movimiento_tipo),
      fecha: new Date(row.Fecha_movimiento).toISOString(),
      codigo_wms: line.id_producto,
      wms_lote_id: line.id_lote,
      nombre: product.Nombre,
      referencia_wms: text(product.Referencia) ? product.Referencia : null,
      unidad_medida: product.Unidad_de_medida,
      cantidad: String(row.Cantidad),
    })
  }
  return result
}
module.exports = { movementsForClient }
