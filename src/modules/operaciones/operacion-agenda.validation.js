const { optional } = require('../../middlewares/validateRequest.middleware')
const { paginationRules } = require('../../utils/businessValidation')
const rules = require('../../utils/validation')
const { queryRules } = require('../movimientos/movimiento.validation')
module.exports = {
  agendaQuery: {
    ...paginationRules,
    buscar: optional(rules.text('buscar', 100)),
    desde: queryRules.desde,
    hasta: queryRules.hasta,
  },
}
