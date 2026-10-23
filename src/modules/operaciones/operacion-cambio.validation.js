const { object } = require('../../middlewares/validateRequest.middleware')
const { preloadBody } = require('../../utils/businessValidation')
const rules = require('../../utils/validation')
const { body: operationBody } = require('./operacion.validation')
const { fail } = require('../../utils/errors')
const nullable = (value) =>
  value === null ? null : rules.text('texto', 1000)(value)
const schema = {
  request_id: preloadBody.request_id,
  tipo: (value) =>
    ['CANCELAR', 'REPROGRAMAR', 'CORREGIR'].includes(value)
      ? value
      : fail(400, 'TIPO_CAMBIO_INVALIDO', 'Tipo de cambio inválido.'),
  motivo: rules.text('motivo', 1000),
  datos: (value) => value,
}
function validateChange(value) {
  const input = object(value, schema, 'cuerpo')
  input.datos = object(
    input.datos,
    input.tipo === 'CANCELAR'
      ? {}
      : input.tipo === 'REPROGRAMAR'
        ? { fecha_programada_at: operationBody.fecha_programada_at }
        : {
            nombre: operationBody.nombre,
            destinatario: operationBody.destinatario,
            observacion: operationBody.observacion,
          },
    'datos',
  )
  return input
}
const decisionSchema = {
  decision: (value) =>
    ['APLICAR', 'RECHAZAR'].includes(value)
      ? value
      : fail(400, 'DECISION_INVALIDA', 'Decisión inválida.'),
  motivo: nullable,
}
module.exports = { schema, validateChange, decisionSchema }
