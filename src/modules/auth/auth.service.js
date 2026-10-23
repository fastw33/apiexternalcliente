const { fail } = require('../../utils/errors')
const { utcDate,bool,string,username,passwordValue,passwordInput } = require('../../utils/security')
const { sessionView } = require('./auth.presenter')

function createAuthService({config,db,security,dummyHash,auditoria,dispositivos,sesiones,terminos}) {
  const {Usuario,Cliente} = db.models
  const view = async(auth,transaction)=>sessionView(auth,security,await terminos.status(auth,transaction))
  async function login(input,deviceCookie,context) {
    const loginName = username(input.username)
    const password = passwordInput(input.password,'password',config)
    const deviceName = input.nombre_dispositivo === undefined ? null : string(input.nombre_dispositivo,'nombre_dispositivo',1,120)
    const result = await db.transaction(async transaction=>{
      const user = await Usuario.scope('conCredenciales').findOne({where:{username_normalizado:loginName},
        include:[{model:Cliente,as:'cliente',required:true}],transaction,lock:transaction.LOCK.UPDATE})
      const correct = await security.verifyPassword(password,user?.password_hash || dummyHash)
      if (!user) {await auditoria.record(transaction,context,'LOGIN_FALLIDO','autenticacion','anonimo');return null}
      const baseAudit = {clientId:user.cliente_id,actorId:user.actor_id}
      if (user.bloqueado_hasta_at && utcDate(user.bloqueado_hasta_at).getTime() > Date.now()) {
        await auditoria.record(transaction,context,'LOGIN_BLOQUEADO','usuario',user.id,baseAudit)
        return null
      }
      const temporaryExpired = bool(user.debe_cambiar_password) && (!user.password_temporal_expira_at || utcDate(user.password_temporal_expira_at).getTime() <= Date.now())
      if (!correct || user.estado !== 'ACTIVO' || !bool(user.cliente.habilitado) || !bool(user.cliente.wms_activo_ultima_validacion) || temporaryExpired) {
        await auditoria.record(transaction,context,'LOGIN_FALLIDO','usuario',user.id,baseAudit)
        if (!correct && await auditoria.recentLoginFailures(transaction,user.actor_id,config.rate.lockMinutes) >= config.rate.accountFailures) {
          await user.update({bloqueado_hasta_at:new Date(Date.now()+config.rate.lockMinutes*60000)},{transaction})
        }
        return null
      }
      const {device,token} = await dispositivos.resolve(user,deviceCookie,deviceName,context,transaction)
      const session = await sesiones.create(user,device.id,bool(user.debe_cambiar_password) ? 'PROVISIONAL' : 'NORMAL',context,transaction)
      await user.update({bloqueado_hasta_at:null},{transaction})
      await auditoria.record(transaction,context,'LOGIN_EXITOSO','usuario',user.id,{...baseAudit,sessionId:session.id})
      return {session,deviceToken:token,view:await view({...user.get({plain:true}),cliente_nombre:user.cliente.nombre_presentacion,
        sesion_id:session.id,tipo:session.type,expira_at:session.expires,dispositivo_id:device.id,dispositivo_nombre:device.nombre,token:session.token},transaction)}
    })
    if (!result) fail(401,'CREDENCIALES_INVALIDAS','Credenciales inválidas o acceso no habilitado.')
    return result
  }
  async function changePassword(auth,input,context) {
    const current = passwordInput(input.password_actual,'password_actual',config)
    const next = passwordValue(input.password_nueva,config)
    if (current === next) fail(400,'PASSWORD_REUTILIZADA','La contraseña nueva debe ser diferente.')
    const hash = await security.hashPassword(next)
    return db.transaction(async transaction=>{
      const fresh = await sesiones.load(auth.token,auth.deviceToken,transaction,true)
      if (!await security.verifyPassword(current,fresh.password_hash)) fail(401,'PASSWORD_ACTUAL_INVALIDA','La contraseña actual no es válida.')
      await Usuario.update({password_hash:hash,debe_cambiar_password:false,password_temporal_expira_at:null,
        password_cambiado_at:new Date(),version_credenciales:fresh.version_credenciales+1,bloqueado_hasta_at:null},
      {where:{id:fresh.id,cliente_id:fresh.cliente_id},transaction})
      await sesiones.revokeForUser(fresh.id,'PASSWORD_CAMBIADA',transaction)
      const user = {...fresh,version_credenciales:fresh.version_credenciales+1,debe_cambiar_password:false,password_temporal_expira_at:null}
      const session = await sesiones.create(user,fresh.dispositivo_id,'NORMAL',context,transaction)
      await auditoria.record(transaction,context,'PASSWORD_CAMBIADA','usuario',fresh.id,
        {clientId:fresh.cliente_id,actorId:fresh.actor_id,sessionId:fresh.sesion_id,detail:{nueva_sesion_id:session.id}})
      return {session,view:await view({...user,sesion_id:session.id,tipo:'NORMAL',expira_at:session.expires,token:session.token},transaction)}
    })
  }
  return {login,changePassword,view}
}
module.exports = { createAuthService }
