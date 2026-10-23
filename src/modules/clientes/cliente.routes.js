const { Router } = require('express')
const body = require('../../middlewares/validateBody.middleware')
const {validateRequest,optional} = require('../../middlewares/validateRequest.middleware')
const rules = require('../../utils/validation')

function createClienteRoutes(controller) {
  const router=Router()
  router.get('/',validateRequest({query:{page:optional(rules.page),limit:optional(rules.limit)}}),controller.list)
  router.get('/:id/validacion',validateRequest({query:{},params:{id:rules.clientId}}),controller.validate)
  router.patch('/:id/habilitacion',validateRequest({query:{},params:{id:rules.id}}),body({habilitado:rules.boolean}),controller.changeState)
  return router
}
module.exports = { createClienteRoutes }
