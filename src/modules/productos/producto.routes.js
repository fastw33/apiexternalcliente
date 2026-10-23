const { Router } = require('express')
const {
  validateRequest,
  optional,
} = require('../../middlewares/validateRequest.middleware')
const rules = require('../../utils/validation')
const {
  productBody,
  paginationRules,
} = require('../../utils/businessValidation')
function createProductoRoutes({ controller, middleware }) {
  const router = Router()
  router.use(middleware.authenticated, middleware.normal)
  router.get('/catalogo', validateRequest({ query: {} }), controller.catalog)
  router.get(
    '/bodega',
    validateRequest({
      query: {
        ...paginationRules,
        buscar: optional(rules.text('buscar', 250)),
      },
    }),
    controller.directory,
  )
  const { request_id, confirmar_diferente, ...fields } = productBody
  router.get(
    '/similares',
    validateRequest({
      query: Object.fromEntries(
        Object.entries(fields).map(([key, rule]) => [key, optional(rule)]),
      ),
    }),
    controller.suggestions,
  )
  router.post(
    '/vincular',
    middleware.csrf,
    validateRequest({
      query: {},
      body: { codigo_wms: rules.text('codigo_wms', 250) },
    }),
    controller.useExisting,
  )
  router.post(
    '/:id/confirmar',
    middleware.csrf,
    validateRequest({ query: {}, params: { id: rules.id }, body: {} }),
    controller.confirm,
  )
  router.get('/', validateRequest({ query: paginationRules }), controller.list)
  router.delete(
    '/:id',
    middleware.csrf,
    validateRequest({ query: {}, params: { id: rules.id }, body: {} }),
    controller.remove,
  )
  router.post(
    '/',
    middleware.csrf,
    validateRequest({ query: {}, body: productBody }),
    controller.create,
  )
  return router
}
module.exports = { createProductoRoutes }
