const { fail } = require('../../utils/errors')
function operatingHours(config) {
  const { openingTime: inicio, closingTime: fin } = config.operations || {}
  const valid = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
  if (!valid(inicio) || !valid(fin) || inicio >= fin)
    fail(503,'HORARIO_NO_CONFIGURADO','No se ha configurado el horario de recogidas.')
  return { inicio, fin, zona_horaria: 'America/Bogota' }
}
function validateHours(pickup, config) {
  const hours = operatingHours(config)
  const date = new Date(pickup)
  if (!Number.isFinite(+date)) fail(422,'HORARIO_NO_PERMITIDO','La fecha de recogida no es válida.')
  const local = new Date(+date - 5 * 3600000).toISOString().slice(11,23)
  if (local < hours.inicio + ':00.000' || local > hours.fin + ':00.000')
    fail(422,'HORARIO_NO_PERMITIDO',`La llegada del vehículo debe estar entre ${hours.inicio} y ${hours.fin}, hora de Colombia.`)
}
module.exports = { operatingHours, validateHours }
