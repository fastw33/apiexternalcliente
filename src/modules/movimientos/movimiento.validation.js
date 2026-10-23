const { optional } = require('../../middlewares/validateRequest.middleware')
const { paginationRules } = require('../../utils/businessValidation')
const { fail } = require('../../utils/errors')
const rules = require('../../utils/validation')

const tipos = [
  'ENTRADA',
  'SALIDA',
  'REUBICACION',
  'TRANSFORMACION',
  'ALISTAMIENTO',
]
function date(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value < '1900-01-01' ||
    value > '9999-12-31' ||
    !Number.isFinite(Date.parse(value + 'T00:00:00Z')) ||
    new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value
  )
    fail(400, 'FECHA_INVALIDA', 'Selecciona una fecha válida.')
  return value
}
const queryRules = {
  ...paginationRules,
  buscar: optional(rules.text('buscar', 250)),
  tipo: optional((value) =>
    tipos.includes(value)
      ? value
      : fail(
          400,
          'TIPO_MOVIMIENTO_INVALIDO',
          'Selecciona un tipo de movimiento válido.',
        ),
  ),
  desde: optional(date),
  hasta: optional(date),
}
module.exports = { queryRules }
