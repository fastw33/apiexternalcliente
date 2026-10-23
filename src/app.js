const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const { rateLimit } = require('express-rate-limit')
const { isUtf8 } = require('node:buffer')
const { AppError,createErrorHandler } = require('./utils/errors')
const { createLogger } = require('./utils/logger')
const requestLog = require('./middlewares/requestLog.middleware')
const guard = require('./middlewares/requestGuard.middleware')
const { createSecurity,randomSecret } = require('./utils/security')
const context = require('./middlewares/context.middleware')
const { createWms } = require('./integrations/wms/wms.client')
const { createModules } = require('./modules')
const { createRoutes } = require('./routes')

async function createApp({config,db,wms=createWms(config),logger=createLogger({environment:config.nodeEnv,level:config.logLevel})}) {
  const security=createSecurity(config)
  const dummyHash=await security.hashPassword(randomSecret())
  const modules=createModules({config,db,security,wms,dummyHash,logger})
  const app=express()
  app.disable('x-powered-by')
  app.set('query parser','simple')
  app.set('trust proxy',config.trustProxy)
  app.use(helmet({strictTransportSecurity:config.cookie.secure ? undefined : false}))
  app.use(context)
  app.use(requestLog(logger))
  const limiter=max=>rateLimit({windowMs:config.rate.windowMs,limit:max,standardHeaders:'draft-7',legacyHeaders:false,
    keyGenerator:req=>req.context.ip,
    handler:(req,res,next)=>next(new AppError(429,'LIMITE_SOLICITUDES','Demasiados intentos. Intenta más tarde.'))})
  app.use('/api',limiter(config.rate.max))
  app.use(guard.beforeBody(config.http))
  app.use((req,res,next)=>{
    if (req.headers.origin && !config.origins.includes(req.headers.origin)) {
      return next(new AppError(403,'ORIGEN_NO_PERMITIDO','Origen no autorizado.'))
    }
    next()
  })
  app.use(cors({origin:(origin,callback)=>callback(null,!origin || config.origins.includes(origin)),credentials:true,
    methods:['GET','POST','PATCH','DELETE','OPTIONS'],allowedHeaders:['Content-Type','Authorization','X-CSRF-Token'],
    exposedHeaders:['X-Correlation-ID']}))
  const jsonParser = limit => express.json({limit,strict:true,inflate:false,
    verify:(req,res,buffer)=>{if (!isUtf8(buffer)) throw new AppError(400,'UTF8_INVALIDO','El cuerpo debe contener UTF-8 válido.')}})
  const defaultParser=jsonParser(config.http.bodyLimitBytes)
  const operationParser=jsonParser(config.operations.bodyLimitBytes)
  app.use((req,res,next)=>(guard.isOperationCreate(req)?operationParser:defaultParser)(req,res,next))
  app.use(guard.afterBody(config.http,config.operations))
  app.use(createRoutes({config,db,security,modules,
    limiters:{login:limiter(config.rate.loginMax),password:limiter(config.rate.loginMax)}}))
  logger.info('RUTAS_CARGADAS')
  app.use((req,res,next)=>next(new AppError(404,'RUTA_NO_EXISTE','Ruta no disponible.')))
  app.use(createErrorHandler(logger))
  return app
}
module.exports = { createApp }
