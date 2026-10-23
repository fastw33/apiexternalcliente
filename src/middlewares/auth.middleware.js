const { AppError } = require('../utils/errors')
const { safeEqual,isSecret } = require('../utils/security')

function createAuthMiddleware({security,sesiones,terminos,cookies}) {
  const internal = (req,res,next)=>{
    try {req.internal=security.internalIdentity(req.headers.authorization);next()}
    catch(error) {next(error)}
  }
  const internalOperations = (req,res,next)=>{
    try {req.internal=security.internalIdentity(req.headers.authorization,['esAdmin','gestionBodega']);next()}
    catch(error) {next(error)}
  }
  const internalAgenda = (req,res,next)=>{
    try {req.internal=security.internalIdentity(req.headers.authorization,[]);next()}
    catch(error) {next(error)}
  }
  const authenticated = (req,res,next)=>sesiones.authenticate(cookies.sessionToken(req),cookies.deviceToken(req))
    .then(auth=>{req.customer=auth;next()}).catch(next)
  const passwordChanged = (req,res,next)=>{
    if (req.customer.tipo !== 'NORMAL') return next(new AppError(403,'CAMBIO_PASSWORD_REQUERIDO','Cambia la contraseña temporal antes de operar.'))
    next()
  }
  const normal = (req,res,next)=>passwordChanged(req,res,error=>{
    if (error) return next(error)
    terminos.requireAcceptance(req.customer).then(()=>next()).catch(next)
  })
  const csrf = (req,res,next)=>{
    const token = cookies.sessionToken(req)
    if (!isSecret(token) || typeof req.headers['x-csrf-token'] !== 'string' ||
        !safeEqual(req.headers['x-csrf-token'],security.csrf(token))) {
      return next(new AppError(403,'CSRF_INVALIDO','La verificación de la petición no es válida.'))
    }
    next()
  }
  const csrfIfSession = (req,res,next)=>isSecret(cookies.sessionToken(req)) ? csrf(req,res,next) : next()
  return {internal,internalOperations,internalAgenda,authenticated,passwordChanged,normal,csrf,csrfIfSession}
}
module.exports = { createAuthMiddleware }
