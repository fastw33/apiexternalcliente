const { AppError } = require('../utils/errors')
const optional = rule => ({rule,optional:true})

function object(value,schema,location,allowMissing=false) {
  if (value === undefined && allowMissing) value={}
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError(400,'DATOS_INVALIDOS',`Se requiere un objeto válido en ${location}.`)
  }
  if (Object.keys(value).some(key=>!Object.hasOwn(schema,key))) {
    throw new AppError(400,'CAMPOS_NO_PERMITIDOS',`Hay campos no permitidos en ${location}.`)
  }
  const clean={}
  for (const [key,spec] of Object.entries(schema)) {
    const rule=typeof spec === 'function' ? spec : spec.rule
    if (!Object.hasOwn(value,key)) {
      if (spec.optional) continue
      throw new AppError(400,'CAMPO_REQUERIDO',`Falta el campo ${key} en ${location}.`)
    }
    clean[key]=rule(value[key])
  }
  return clean
}
function validateRequest({body,query,params,optionalBody=false}) {
  return (req,res,next)=>{
    try {
      req.validated ??= {}
      if (query) req.validated.query=object(req.query,query,'consulta')
      if (params) req.validated.params=object(req.params,params,'ruta')
      if (body) {
        if (req.body !== undefined && !req.is('application/json')) throw new AppError(415,'JSON_REQUERIDO','Envía un objeto application/json.')
        req.body=object(req.body,body,'cuerpo',optionalBody)
        req.validated.body=req.body
      }
      next()
    } catch(error) {next(error)}
  }
}
module.exports = { validateRequest,optional,object }
