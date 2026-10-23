const { Router } = require('express')
const {validateRequest} = require('../../middlewares/validateRequest.middleware')
const {id} = require('../../utils/validation')

function createSesionRoutes(controller,csrf) {
  const router=Router()
  router.get('/',controller.list)
  router.delete('/:id',csrf,validateRequest({params:{id},body:{},optionalBody:true}),controller.revoke)
  return router
}
module.exports = { createSesionRoutes }
