const { Router } = require('express')
const {
  validateRequest,
  optional,
} = require('../../middlewares/validateRequest.middleware')
const { paginationRules } = require('../../utils/businessValidation')
const rules = require('../../utils/validation')
const { productQuery, lotsQuery } = require('./inventario.filters')
function createInventarioRoutes({ controller, middleware }) {
  const router = Router()
  router.use(middleware.authenticated, middleware.normal)
  router.get(
    '/productos',
    validateRequest({ query: productQuery }),
    controller.products,
  )
  router.get(
    '/productos/:codigo/lotes',
    validateRequest({
      params: { codigo: rules.text('codigo', 250) },
      query: lotsQuery,
    }),
    controller.lots,
  )
  router.get(
    '/',
    validateRequest({
      query: {
        ...paginationRules,
        buscar: optional(rules.text('buscar', 250)),
      },
    }),
    controller.list,
  )
  return router
}
module.exports = { createInventarioRoutes }
