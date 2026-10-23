const { AppError } = require('../utils/errors')
const forbidden=new Set(['__proto__','prototype','constructor'])

function checkStructure(value,maxDepth,maxKeys) {
  const pending=[{value,depth:0}]
  let count=0
  while (pending.length) {
    const {value,depth}=pending.pop()
    if (!value || typeof value !== 'object') continue
    if (depth > maxDepth) throw new AppError(400,'ESTRUCTURA_EXCESIVA','La estructura enviada supera el límite permitido.')
    for (const [key,child] of Object.entries(value)) {
      if (++count > maxKeys) throw new AppError(400,'ESTRUCTURA_EXCESIVA','La estructura enviada supera el límite permitido.')
      if (forbidden.has(key) || key.startsWith('$') || /[.\[\]\u0000-\u001F\u007F]/.test(key)) {
        throw new AppError(400,'CLAVE_NO_PERMITIDA','La petición contiene una clave no permitida.')
      }
      if (child && typeof child === 'object') pending.push({value:child,depth:depth+1})
    }
  }
}
function beforeBody(config) {
  return (req,res,next)=>{
    try {
      if (!['GET','HEAD','POST','PATCH','DELETE','OPTIONS'].includes(req.method)) {
        throw new AppError(405,'METODO_NO_PERMITIDO','Método no permitido.')
      }
      if (req.originalUrl.length > config.maxUrlLength) throw new AppError(414,'URL_EXCESIVA','La URL supera el límite permitido.')
      const singleton=new Set(['authorization','origin','x-csrf-token','content-type','host'])
      const headerNames=new Set()
      for (let i=0;i<req.rawHeaders.length;i+=2) {
        const name=req.rawHeaders[i].toLowerCase()
        if (singleton.has(name) && headerNames.has(name)) throw new AppError(400,'CABECERA_DUPLICADA','No se permiten cabeceras de seguridad repetidas.')
        headerNames.add(name)
      }
      const query=req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')+1) : ''
      const seen=new Set()
      for (const [key,value] of new URLSearchParams(query)) {
        if (!/^[a-z][a-z0-9_]{0,39}$/.test(key) || forbidden.has(key) || /[\u0000-\u001F\u007F]/.test(value)) {
          throw new AppError(400,'CONSULTA_INVALIDA','Los parámetros de consulta no son válidos.')
        }
        if (seen.has(key)) throw new AppError(400,'PARAMETRO_DUPLICADO','No se permiten parámetros repetidos.')
        seen.add(key)
        if (seen.size > config.maxQueryKeys) throw new AppError(400,'CONSULTA_EXCESIVA','Demasiados parámetros de consulta.')
      }
      const hasBody=Number(req.headers['content-length'] || 0) > 0 || req.headers['transfer-encoding'] !== undefined
      if (hasBody && ['GET','HEAD','OPTIONS'].includes(req.method)) {
        throw new AppError(400,'CUERPO_NO_PERMITIDO','Este método no admite cuerpo.')
      }
      const documentFile = req.method === 'POST' && /^\/api\/documentos\/[a-z][a-z0-9_]{0,59}\/?$/.test(req.path) &&
        ['application/pdf','image/jpeg','image/png'].some(type=>req.is(type))
      if (hasBody && !req.is('application/json') && !documentFile) throw new AppError(415,'JSON_REQUERIDO','Envía un objeto application/json.')
      next()
    } catch(error) {next(error)}
  }
}
const isOperationCreate = req => req.method === 'POST' && req.path?.replace(/\/$/,'') === '/api/operaciones'
function afterBody(config,operations) {
  return (req,res,next)=>{
    try {checkStructure(req.body,config.maxDepth,isOperationCreate(req) && operations ? operations.maxKeys : config.maxKeys);next()}
    catch(error) {next(error)}
  }
}
module.exports = { beforeBody,afterBody,checkStructure,isOperationCreate }
