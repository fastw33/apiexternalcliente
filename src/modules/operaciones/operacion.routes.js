const { Router } = require('express')
const {
  validateRequest,
} = require('../../middlewares/validateRequest.middleware')
const {
  paginationRules,
  preloadBody,
} = require('../../utils/businessValidation')
const { body } = require('./operacion.validation')
const { schema: changeBody } = require('./operacion-cambio.validation')
function createOperacionRoutes({ controller, middleware }) {
  const router = Router()
  router.use(middleware.authenticated, middleware.normal)
  router.get('/', validateRequest({ query: paginationRules }), controller.list)
  router.post(
    '/',
    middleware.csrf,
    validateRequest({ query: {}, body }),
    controller.create,
  )
  const params = { public_id: preloadBody.request_id }
  router.post('/:public_id/cambios',middleware.csrf,
    validateRequest({query:{},params,body:changeBody}),controller.change)
  router.get(
    '/:public_id',
    validateRequest({ query: {}, params }),
    controller.detail,
  )
  router.post(
    '/:public_id/confirmar',
    middleware.csrf,
    validateRequest({ query: {}, params, body: {} }),
    controller.integrate,
  )
  return router
}
module.exports = { createOperacionRoutes }
