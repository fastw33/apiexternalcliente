const { Router } = require('express')
const {validateRequest}=require('../../middlewares/validateRequest.middleware')

function createSaludRoutes(controller) {
  const router=Router()
  router.get('/health',validateRequest({query:{}}),controller.health)
  router.get('/ready',validateRequest({query:{}}),controller.ready)
  return router
}
module.exports = { createSaludRoutes }
