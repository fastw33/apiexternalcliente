class AppError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}
const fail = (status, code, message) => { throw new AppError(status,code,message) }
function describeError(error) {
  if (error instanceof AppError) return error
  if (error.type === 'entity.parse.failed') return new AppError(400,'JSON_INVALIDO','El cuerpo JSON no es válido.')
  if (error.type === 'entity.too.large') return new AppError(413,'CUERPO_EXCESIVO','La petición supera el límite permitido.')
  if (['encoding.unsupported','charset.unsupported'].includes(error.type)) return new AppError(415,'CODIFICACION_NO_PERMITIDA','La codificación no está permitida.')
  if (['request.aborted','request.size.invalid'].includes(error.type)) return new AppError(400,'PETICION_INCOMPLETA','La petición está incompleta.')
  if (error instanceof URIError) return new AppError(400,'RUTA_INVALIDA','La ruta no es válida.')
  if (error.code === 'ER_DUP_ENTRY' || error.name === 'SequelizeUniqueConstraintError') {
    return new AppError(409,'REGISTRO_DUPLICADO','El identificador ya está registrado.')
  }
  if (error.name === 'SequelizeValidationError') return new AppError(400,'DATOS_INVALIDOS','Los datos no cumplen las validaciones del modelo.')
  return new AppError(500,'ERROR_INTERNO','No fue posible completar la operación.')
}
function errorType(error) {
  const code=error.code || error.original?.code
  if (/^ER_[A-Z_]{1,80}$/.test(code || '')) return code
  if (['EADDRINUSE','EACCES','ECONNREFUSED','ENOTFOUND','ETIMEDOUT','ECONNRESET','EPIPE','EPERM'].includes(code)) return code
  return ['AppError','Error','TypeError','RangeError','URIError','SyntaxError','SequelizeValidationError',
    'SequelizeUniqueConstraintError','SequelizeDatabaseError','SequelizeConnectionError','SequelizeConnectionRefusedError',
    'SequelizeAccessDeniedError','SequelizeHostNotFoundError','SequelizeConnectionTimedOutError',
    'SequelizeConnectionAcquireTimeoutError','SequelizeForeignKeyConstraintError'].includes(error.name) ? error.name : 'Error'
}
function createErrorHandler(logger) {
  const {requestFields}=require('./logger')
  return (error,req,res,next)=>{
    if (!(error instanceof Error)) error=new Error()
    const result=describeError(error)
    const level=result.status >= 500 ? 'error' : 'warn'
    res.locals.errorCode=result.code
    logger[level]('HTTP_ERROR',{...requestFields(req),http_status:result.status,codigo:result.code,error_tipo:errorType(error)})
    if (res.headersSent) {res.destroy();return}
    if (req.aborted || res.destroyed) return
    res.setHeader('Cache-Control','no-store')
    if (result.code === 'AUTENTICACION_OCUPADA') res.setHeader('Retry-After','1')
    if (result.status === 405) res.setHeader('Allow','GET, HEAD, POST, PATCH, DELETE, OPTIONS')
    res.status(result.status).json({error:{code:result.code,message:result.message},correlation_id:req.correlationId})
  }
}
module.exports = { AppError,fail,createErrorHandler,errorType }
