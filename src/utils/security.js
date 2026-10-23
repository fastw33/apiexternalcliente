const crypto = require('node:crypto')
const { promisify } = require('node:util')
const jwt = require('jsonwebtoken')
const { fail } = require('./errors')
const scrypt = promisify(crypto.scrypt)

function safeEqual(a,b) {
  const x = Buffer.from(a || '')
  const y = Buffer.from(b || '')
  return x.length === y.length && crypto.timingSafeEqual(x,y)
}
const randomSecret = () => crypto.randomBytes(32).toString('base64url')
const isSecret = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value)
const utcDate = value => value instanceof Date ? value : new Date(String(value).replace(' ','T') + (String(value).endsWith('Z') ? '' : 'Z'))
const isoDate = value => value ? utcDate(value).toISOString() : null
const bool = value => value === true || value === 1 || value === '1'
function positiveId(value) {
  const id = String(value ?? '')
  if (!/^[1-9][0-9]{0,19}$/.test(id) || BigInt(id) > 18446744073709551615n) fail(400,'ID_INVALIDO','Identificador inválido.')
  return id
}
function string(value, name, min=1, max=250) {
  if (typeof value !== 'string' || value.length < min || value.length > max || /[\u0000-\u001F\u007F]/.test(value) ||
      Buffer.from(value,'utf8').toString('utf8') !== value) {
    fail(400,'DATOS_INVALIDOS',`El campo ${name} no es válido.`)
  }
  return value
}
function username(value) {
  const result = string(value,'username',3,100).trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9._@-]{2,99}$/.test(result)) fail(400,'DATOS_INVALIDOS','Username admite letras, números, punto, guion, @ y guion bajo.')
  return result
}
function clientId(value) {
  const result = string(value,'wms_cliente_id',1,250).trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,249}$/.test(result)) fail(400,'DATOS_INVALIDOS','Identificador WMS inválido.')
  return result
}
function passwordValue(value,config) {
  passwordInput(value,'password_nueva',config)
  if (typeof value !== 'string' || Array.from(value).length < config.password.minLength || Array.from(value).length > config.password.maxLength || value.includes('\0')) {
    fail(400,'PASSWORD_INVALIDA',`La contraseña debe tener entre ${config.password.minLength} y ${config.password.maxLength} caracteres.`)
  }
  return value
}
function passwordInput(value,name,config) {
  if (typeof value !== 'string' || !value || Array.from(value).length > config.password.maxLength ||
      value.includes('\0') || Buffer.from(value,'utf8').toString('utf8') !== value) {
    fail(400,'PASSWORD_INVALIDA',`El campo ${name} no es válido.`)
  }
  return value
}
function createSecurity(config) {
  const digest = (scope,value) => crypto.createHmac('sha256',config.session.hashSecret).update(`${scope}:${value}`).digest()
  const csrf = token => crypto.createHmac('sha256',config.session.csrfSecret).update(`csrf:${token}`).digest('base64url')
  const prehash = password => crypto.createHmac('sha256',config.password.pepper).update(password,'utf8').digest()
  let active=0
  async function derive(password,salt,options) {
    if (active >= config.password.maxConcurrent) fail(503,'AUTENTICACION_OCUPADA','La autenticación está ocupada. Intenta nuevamente.')
    active++
    try {return await scrypt(prehash(password),salt,64,options)}
    finally {active--}
  }
  async function hashPassword(password) {
    const salt = crypto.randomBytes(16)
    const result = await derive(password,salt,{N:config.password.N,r:8,p:config.password.p,maxmem:256*1024*1024})
    return ['scrypt',config.password.N,8,config.password.p,salt.toString('base64url'),result.toString('base64url')].join('$')
  }
  async function verifyPassword(password,hash) {
    if (typeof hash !== 'string') return false
    const [algorithm,n,r,p,salt,expected,...rest] = hash.split('$')
    if (algorithm !== 'scrypt' || rest.length || ![16384,32768,65536,131072].includes(Number(n)) || r !== '8' || !/^[1-8]$/.test(p || '') ||
        !/^[A-Za-z0-9_-]{22}$/.test(salt || '') || !/^[A-Za-z0-9_-]{86}$/.test(expected || '')) return false
    const result = await derive(password,Buffer.from(salt,'base64url'),{N:Number(n),r:8,p:Number(p),maxmem:256*1024*1024})
    return safeEqual(result,Buffer.from(expected,'base64url'))
  }
  function internalIdentity(header, allowedPermissions = ['esAdmin']) {
    if (typeof header !== 'string' || !/^Bearer [A-Za-z0-9_.-]+$/.test(header) || header.length > 16384) {
      fail(401,'JWT_WMS_REQUERIDO','Se requiere el JWT de WMS.')
    }
    let payload
    try { payload = jwt.verify(header.slice(7),config.wms.jwtSecret,{algorithms:['HS256']}) }
    catch { fail(401,'JWT_WMS_INVALIDO','JWT WMS inválido o vencido.') }
    if (!payload || !Number.isInteger(payload.exp) || !Number.isSafeInteger(payload.id_usuario) || payload.id_usuario < 1 ||
        typeof payload.username !== 'string' || payload.username.length > 100 || bool(payload.debe_cambiar_password)) {
      fail(401,'JWT_WMS_INVALIDO','La sesión WMS no está habilitada para operar.')
    }
    // WMS puede incluir su columna JSON de permisos como texto dentro del JWT firmado.
    let permisos = payload.permisos
    if (typeof permisos === 'string') {
      try { permisos = JSON.parse(permisos) } catch { permisos = null }
    }
    if (allowedPermissions.length && (!permisos || typeof permisos !== 'object' || Array.isArray(permisos) || !allowedPermissions.some(permission => permisos[permission] === true))) {
      const operations = allowedPermissions.includes('gestionBodega')
      fail(403, operations ? 'OPERADOR_WMS_REQUERIDO' : 'ADMIN_WMS_REQUERIDO', operations
        ? 'Esta acción requiere el permiso gestionBodega o esAdmin de WMS.'
        : 'Esta acción requiere el permiso esAdmin de WMS.')
    }
    const personalId = payload.id_personal || payload.personal?.id_personal
    if (typeof personalId !== 'string' || !personalId || personalId.length > 250) fail(401,'JWT_WMS_INVALIDO','El JWT WMS no contiene la referencia de personal.')
    return { id:String(payload.id_usuario),username:payload.username,personalId,
      name:[payload.personal?.nombre,payload.personal?.apellido].filter(v=>typeof v==='string').join(' ').slice(0,250) || payload.username,
      bearer:header }
  }
  return { digest,csrf,hashPassword,verifyPassword,internalIdentity }
}
function readCookie(req,name) {
  const items = String(req.headers.cookie || '').split(';').map(v=>v.trim()).filter(v=>v.startsWith(`${name}=`))
  if (items.length !== 1) return null
  try { return decodeURIComponent(items[0].slice(name.length+1)) } catch { return null }
}
module.exports = { createSecurity,safeEqual,randomSecret,isSecret,utcDate,isoDate,bool,positiveId,string,username,clientId,passwordValue,passwordInput,readCookie }
