const { Router } = require('express')
const { publicId, revision } = require('./precarga-interno.routes')
const {
  validateRequest,
} = require('../../middlewares/validateRequest.middleware')
const {
  preloadBody,
  paginationRules,
} = require('../../utils/businessValidation')
function createPrecargaRoutes({ controller, middleware }) {
  const router = Router()
  router.use(middleware.authenticated, middleware.normal)
  router.get('/', validateRequest({ query: paginationRules }), controller.list)
  router.get(
    '/:public_id',
    validateRequest({ query: {}, params: { public_id: publicId } }),
    controller.detail,
  )
  router.post(
    '/:public_id/crear-lote',
    middleware.csrf,
    validateRequest({
      query: {},
      params: { public_id: publicId },
      body: { revision },
    }),
    controller.createLot,
  )
  router.post(
    '/',
    middleware.csrf,
    validateRequest({ query: {}, body: preloadBody }),
    controller.create,
  )
  return router
}
module.exports = { createPrecargaRoutes }
