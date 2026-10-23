const { Op } = require('sequelize')
const { fail } = require('../../utils/errors')
const { randomSecret,isSecret,utcDate,isoDate,bool,positiveId } = require('../../utils/security')

function createSesionService({config,db,security,auditoria}) {
  const {Sesion,Usuario,Cliente,Dispositivo} = db.models
  async function create(user,deviceId,type,context,transaction) {
    const token = randomSecret()
    const now = new Date()
    const duration = type === 'PROVISIONAL' ? config.session.provisionalMinutes : config.session.ttlMinutes
    let expires = new Date(now.getTime()+duration*60000)
    if (type === 'PROVISIONAL') expires = new Date(Math.min(expires.getTime(),utcDate(user.password_temporal_expira_at).getTime()))
    const session = await Sesion.create({cliente_id:user.cliente_id,usuario_id:user.id,dispositivo_id:deviceId,
      secreto_hash:security.digest('session',token),tipo:type,version_credenciales:user.version_credenciales,
      ip_inicio:context.ip,navegador_inicio:context.userAgent,ultimo_uso_at:now,expira_at:expires},{transaction})
    return {token,id:String(session.id),expires,type}
  }
  async function load(token,deviceToken,transaction,lock=false) {
    if (!isSecret(token) || !isSecret(deviceToken)) fail(401,'SESION_REQUERIDA','Inicia sesión para continuar.')
    const options = {transaction,...(lock ? {lock:transaction.LOCK.UPDATE} : {})}
    const session = await Sesion.findOne({where:{secreto_hash:security.digest('session',token)},...options})
    if (!session) fail(401,'SESION_INVALIDA','La sesión venció o fue revocada.')
    const user = await Usuario.scope('conCredenciales').findOne({where:{id:session.usuario_id,cliente_id:session.cliente_id},
      include:[{model:Cliente,as:'cliente',required:true}],...options})
    const device = user ? await Dispositivo.findOne({where:{id:session.dispositivo_id,usuario_id:user.id,cliente_id:user.cliente_id},...options}) : null
    const now = Date.now()
    if (!user || !device || user.estado !== 'ACTIVO' || !bool(user.cliente.habilitado) || !bool(user.cliente.wms_activo_ultima_validacion) ||
        session.revocada_at || device.revocado_at || user.version_credenciales !== session.version_credenciales ||
        !device.identificador_hash.equals(security.digest('device',deviceToken)) || utcDate(session.expira_at).getTime() <= now ||
        utcDate(session.ultimo_uso_at).getTime()+config.session.idleMinutes*60000 <= now ||
        (bool(user.debe_cambiar_password) !== (session.tipo === 'PROVISIONAL')) ||
        (session.tipo === 'PROVISIONAL' && (!user.password_temporal_expira_at || utcDate(user.password_temporal_expira_at).getTime() <= now))) {
      fail(401,'SESION_INVALIDA','La sesión venció o fue revocada.')
    }
    return {...user.get({plain:true}),cliente_nombre:user.cliente.nombre_presentacion,sesion_id:String(session.id),
      tipo:session.tipo,expira_at:session.expira_at,dispositivo_id:String(device.id),dispositivo_nombre:device.nombre,token,deviceToken}
  }
  async function authenticate(token,deviceToken) {
    const auth = await load(token,deviceToken)
    await Sesion.update({ultimo_uso_at:new Date()},{where:{id:auth.sesion_id,revocada_at:null}})
    return auth
  }
  async function revokeForUser(id,reason,transaction) {
    await Sesion.update({revocada_at:new Date(),motivo_revocacion:reason},{where:{usuario_id:id,revocada_at:null},transaction})
  }
  async function list(auth) {
    const rows = await Sesion.findAll({where:{cliente_id:auth.cliente_id,usuario_id:auth.id,revocada_at:null,
      expira_at:{[Op.gt]:new Date()},ultimo_uso_at:{[Op.gt]:new Date(Date.now()-config.session.idleMinutes*60000)},
      version_credenciales:auth.version_credenciales},include:[{model:Dispositivo,as:'dispositivo',required:true,
      where:{cliente_id:auth.cliente_id,usuario_id:auth.id,revocado_at:null}}],order:[['id','DESC']],limit:100})
    return {data:rows.map(row=>({id:String(row.id),actual:String(row.id)===String(auth.sesion_id),tipo:row.tipo,
      ip_inicio:row.ip_inicio,navegador:row.navegador_inicio,nombre_dispositivo:row.dispositivo.nombre,
      creado_at:isoDate(row.creado_at),ultimo_uso_at:isoDate(row.ultimo_uso_at),expira_at:isoDate(row.expira_at)}))}
  }
  async function revoke(auth,id,context) {
    id = positiveId(id)
    await db.transaction(async transaction=>{
      await load(auth.token,auth.deviceToken,transaction,true)
      const session = await Sesion.findOne({where:{id,cliente_id:auth.cliente_id,usuario_id:auth.id},transaction,lock:transaction.LOCK.UPDATE})
      if (!session) fail(404,'SESION_NO_EXISTE','La sesión no existe.')
      if (!session.revocada_at) await session.update({revocada_at:new Date(),motivo_revocacion:'CIERRE_POR_USUARIO'},{transaction})
      await auditoria.record(transaction,context,'SESION_REVOCADA','sesion',id,{clientId:auth.cliente_id,actorId:auth.actor_id,sessionId:auth.sesion_id})
    })
    return String(auth.sesion_id) === id
  }
  async function logout(token,context) {
    if (!isSecret(token)) return
    await db.transaction(async transaction=>{
      const session = await Sesion.findOne({where:{secreto_hash:security.digest('session',token),revocada_at:null},transaction,lock:transaction.LOCK.UPDATE})
      if (!session) return
      const user = await Usuario.findOne({where:{id:session.usuario_id,cliente_id:session.cliente_id},transaction})
      if (!user) return
      await session.update({revocada_at:new Date(),motivo_revocacion:'LOGOUT'},{transaction})
      await auditoria.record(transaction,context,'LOGOUT','sesion',session.id,{clientId:session.cliente_id,actorId:user.actor_id,sessionId:session.id})
    })
  }
  return {create,load,authenticate,revokeForUser,list,revoke,logout}
}
module.exports = { createSesionService }
