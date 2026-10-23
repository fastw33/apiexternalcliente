const { Router } = require('express')
const body = require('../../middlewares/validateBody.middleware')
const {validateRequest,optional} = require('../../middlewares/validateRequest.middleware')
const rules = require('../../utils/validation')

function createAuthRoutes({config,controller,middleware,limiters,sesionRoutes}) {
  const router=Router()
  router.use(validateRequest({query:{}}))
  router.post('/login',limiters.login,body({username:rules.username,password:rules.password(config),
    nombre_dispositivo:optional(rules.text('nombre_dispositivo',120))}),controller.login)
  router.get('/me',middleware.authenticated,controller.me)
  router.post('/password',limiters.password,middleware.authenticated,middleware.csrf,
    body({password_actual:rules.password(config),password_nueva:rules.newPassword(config)}),controller.changePassword)
  router.post('/logout',middleware.csrfIfSession,validateRequest({body:{},optionalBody:true}),controller.logout)
  router.use('/sesiones',middleware.authenticated,middleware.normal,sesionRoutes)
  return router
}
module.exports = { createAuthRoutes }
