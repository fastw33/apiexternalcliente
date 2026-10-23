const { Router } = require('express')
const {
  validateRequest,
} = require('../../middlewares/validateRequest.middleware')
const { queryRules } = require('./movimiento.validation')
function createMovimientoRoutes({ controller, middleware }) {
  const router = Router()
  router.use(middleware.authenticated, middleware.normal)
  router.get('/', validateRequest({ query: queryRules }), controller.list)
  return router
}
module.exports = { createMovimientoRoutes }
