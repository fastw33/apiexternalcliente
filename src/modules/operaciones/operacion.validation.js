const rules = require('../../utils/validation')
const { fail } = require('../../utils/errors')
const { object } = require('../../middlewares/validateRequest.middleware')
const { decimal, preloadBody } = require('../../utils/businessValidation')
const { wmsQuantity } = require('../precargas/precarga-wms')
const invalid = () =>
  fail(400, 'OPERACION_INVALIDA', 'Revisa los datos de la operación.')
const nullable = (max) => (value) =>
  value === null ? null : rules.text('texto', max)(value)
const body = {
  request_id: preloadBody.request_id,
  nombre: rules.text('nombre', 120),
  modalidad: (value) => (value === 'RECOGIDA' ? value : invalid()),
  // El navegador envía explícitamente -05:00; no interpretar fechas en zona local del servidor.
  fecha_programada_at: (value) => {
    if (
      typeof value !== 'string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:00-05:00$/.test(value) ||
      !Number.isFinite(+new Date(value))
    )
      invalid()
    const date = new Date(value)
    if (
      new Date(+date - 5 * 3600000).toISOString().slice(0, 19) !==
      value.slice(0, 19)
    )
      invalid()
    return value
  },
  destinatario: nullable(250),
  direccion_entrega: (value) => (value === null ? null : invalid()),
  observacion: nullable(1000),
  detalles: (value) => {
    if (!Array.isArray(value) || value.length < 1) invalid()
    const seen = new Set()
    return value.map((row) => {
      const line = object(
        row,
        {
          codigo_wms: rules.text('codigo', 250),
          wms_lote_id: rules.text('lote', 250),
          cantidad: decimal(14, 6, true),
        },
        'productos',
      )
      const key = JSON.stringify([line.codigo_wms, line.wms_lote_id])
      wmsQuantity(line.cantidad)
      if (seen.has(key))
        fail(
          400,
          'PRODUCTO_REPETIDO',
          'Incluye cada producto/lote una sola vez.',
        )
      seen.add(key)
      return line
    })
  },
}
module.exports = { body }
