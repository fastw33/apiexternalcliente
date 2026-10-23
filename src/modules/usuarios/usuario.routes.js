const { Router } = require('express')
const body = require('../../middlewares/validateBody.middleware')
const {validateRequest,optional} = require('../../middlewares/validateRequest.middleware')
const rules = require('../../utils/validation')

function createUsuarioRoutes(controller) {
  const router=Router()
  router.get('/',validateRequest({query:{cliente_id:optional(rules.id),page:optional(rules.page),limit:optional(rules.limit)}}),controller.list)
  router.post('/',validateRequest({query:{}}),body({wms_cliente_id:rules.clientId,username:rules.username,
    correo:rules.email,perfil:optional(rules.profile)}),controller.provision)
  router.patch('/:id/estado',validateRequest({query:{},params:{id:rules.id}}),body({estado:rules.state}),controller.changeState)
  router.post('/:id/password-temporal',validateRequest({query:{},params:{id:rules.id},body:{},optionalBody:true}),controller.resetPassword)
  return router
}
module.exports = { createUsuarioRoutes }
