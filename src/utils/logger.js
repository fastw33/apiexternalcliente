const fields = ['correlation_id','metodo','ruta','http_status','duracion_ms','ip',
  'usuario_id','cliente_id','sesion_id','wms_usuario_id','codigo','error_tipo','node',
  'modelo','modulo','base_datos','host','puerto']
const levels = {debug:10,info:20,warn:30,error:40,fatal:50}
const clean = value => String(value).replace(/[\u0000-\u001F\u007F\u2028\u2029]/g,'').slice(0,180)

function startupMessage(entry) {
  switch (entry.evento) {
    case 'ARRANQUE_INICIADO': return `📌 Iniciando externalclientes con Node.js ${entry.node}`
    case 'MODELO_CARGADO': return `✅ Modelo ${entry.modelo} cargado correctamente`
    case 'MODULO_CARGADO': return `✅ Módulo ${entry.modulo} cargado correctamente`
    case 'BASE_DATOS_CONECTADA': return `✅ Conexión a la base de datos ${entry.base_datos} establecida.`
    case 'RUTAS_CARGADAS': return '✅ Rutas de externalclientes cargadas correctamente.'
    case 'SERVIDOR_INICIADO': {
      const host=entry.host.includes(':') ? `[${entry.host}]` : entry.host
      return `🚀 Servidor corriendo en http://${host}:${entry.puerto}`
    }
    case 'SERVIDOR_DETENIDO': return '🛑 Servidor detenido.'
    default: return null
  }
}

function createLogger({environment,level='info',startupConsole=false,write=line=>process.stdout.write(line)}) {
  function log(severity,event,data={}) {
    if (levels[severity] < (levels[level] ?? levels.info)) return
    const entry = {fecha_utc:new Date().toISOString(),nivel:severity,servicio:'externalclientes',
      ambiente:clean(environment),evento:clean(event)}
    // Lista cerrada: nunca serializar req, res, Error, cuerpos, cabeceras o configuración.
    for (const field of fields) {
      const value=data[field]
      if (value === undefined || value === null) continue
      if (typeof value === 'number' && Number.isFinite(value)) entry[field]=value
      else if (typeof value === 'string') entry[field]=clean(value)
    }
    const message=startupConsole && severity === 'info' ? startupMessage(entry) : null
    write((message ?? JSON.stringify(entry))+'\n')
  }
  return Object.fromEntries(Object.keys(levels).map(level=>[level,(event,data)=>log(level,event,data)]))
}
function requestFields(req) {
  const route=typeof req.route?.path === 'string' ? `${req.baseUrl || ''}${req.route.path}` : 'SIN_RUTA'
  return {correlation_id:req.correlationId,metodo:req.method,
    ruta:/^[a-zA-Z0-9_/:.{}-]{1,180}$/.test(route) ? route : 'SIN_RUTA',ip:req.context?.ip,
    usuario_id:req.customer ? String(req.customer.id) : undefined,
    cliente_id:req.customer ? String(req.customer.cliente_id) : undefined,
    sesion_id:req.customer ? String(req.customer.sesion_id) : undefined,wms_usuario_id:req.internal?.id}
}
module.exports = { createLogger,requestFields }
