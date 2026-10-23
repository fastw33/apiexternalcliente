const config = require('./config/env')
const { createConnection } = require('./config/db')
const { initializeModels } = require('./models')
const { createApp } = require('./app')
const { createLogger } = require('./utils/logger')
const { createHttpServer } = require('./utils/httpServer')
const { errorType } = require('./utils/errors')
const logger=createLogger({environment:config.nodeEnv,level:config.logLevel,startupConsole:true})

function fatal(error) {
  logger.fatal('PROCESO_NO_CONTROLADO',{codigo:'PROCESO_TERMINADO',error_tipo:errorType(error instanceof Error ? error : new Error())})
  process.exit(1)
}
process.once('uncaughtException',fatal)
process.once('unhandledRejection',fatal)

async function start() {
  logger.info('ARRANQUE_INICIADO',{node:process.versions.node})
  const db = createConnection()
  let server
  try {
    const models=initializeModels(db)
    for (const modelo of Object.keys(models)) logger.info('MODELO_CARGADO',{modelo})
    await db.authenticate()
    logger.info('BASE_DATOS_CONECTADA',{base_datos:config.db.database})
    const app = await createApp({config,db,logger})
    server = createHttpServer(app,config,logger)
    server.listen(config.port,config.host,()=>logger.info('SERVIDOR_INICIADO',{
      node:process.versions.node,host:server.address().address,puerto:server.address().port}))
    server.on('error',async error=>{
      logger.error('SERVIDOR_NO_INICIADO',{codigo:'LISTEN_ERROR',error_tipo:errorType(error)})
      await db.close()
      process.exitCode = 1
    })
  } catch (error) {
    await db.close()
    throw error
  }
  let closing = false
  const close = ()=>{
    if (closing) return
    closing = true
    server.close(async()=>{await db.close();logger.info('SERVIDOR_DETENIDO');process.exitCode=0})
    server.closeIdleConnections()
    setTimeout(()=>{server.closeAllConnections()},5000).unref()
  }
  process.once('SIGINT',close)
  process.once('SIGTERM',close)
}
start().catch(error=>{
  logger.error('ARRANQUE_FALLIDO',{codigo:'REVISAR_CONFIGURACION',error_tipo:errorType(error)})
  process.exitCode = 1
})
