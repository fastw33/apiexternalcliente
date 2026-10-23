const { Router } = require('express')
const body = require('../../middlewares/validateBody.middleware')
const {validateRequest} = require('../../middlewares/validateRequest.middleware')
const rules = require('../../utils/validation')

function createTerminosRoutes({controller,middleware}) {
  const router=Router()
  router.use(validateRequest({query:{}}))
  router.get('/',middleware.authenticated,controller.get)
  router.post('/aceptacion',middleware.authenticated,middleware.passwordChanged,middleware.csrf,
    body({version:rules.text('version',80),contenido_sha256:rules.hash,acepto:rules.boolean,
      autoriza_tratamiento_datos:rules.boolean}),controller.accept)
  return router
}
function createTerminosInternalRoutes(controller) {
  const router=Router()
  router.post('/',validateRequest({query:{}}),body({version:rules.text('version',80),
    titulo:rules.text('titulo',250),contenido:rules.content}),controller.publish)
  return router
}
module.exports = { createTerminosRoutes,createTerminosInternalRoutes }
