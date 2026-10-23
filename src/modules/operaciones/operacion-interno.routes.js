const { Router } = require('express')
const {
  validateRequest,
} = require('../../middlewares/validateRequest.middleware')
const { preloadBody } = require('../../utils/businessValidation')
const { decisionSchema } = require('./operacion-cambio.validation')
const { agendaQuery } = require('./operacion-agenda.validation')
function createOperacionInternoRoutes(controller) {
  const router = Router()
  router.post(
    '/:public_id/cambios/:change_id/decision',
    validateRequest({
      query: {},
      params: {
        public_id: preloadBody.request_id,
        change_id: preloadBody.request_id,
      },
      body: decisionSchema,
    }),
    controller.decide,
  )
  router.get(
    '/',
    validateRequest({
      query: agendaQuery,
    }),
    controller.list,
  )
  router.get(
    '/:public_id',
    validateRequest({
      query: {},
      params: { public_id: preloadBody.request_id },
    }),
    controller.detail,
  )
  return router
}
module.exports = { createOperacionInternoRoutes }
