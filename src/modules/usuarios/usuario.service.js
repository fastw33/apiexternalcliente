const { fail } = require('../../utils/errors')
const { randomSecret,positiveId,string,username,clientId,isoDate } = require('../../utils/security')
const { userView } = require('./usuario.presenter')

function createUsuarioService({config,db,security,clientes,actores,auditoria,sesiones}) {
  const {Usuario,Cliente} = db.models
  async function provision(input,identity,context) {
    const remoteId = clientId(input.wms_cliente_id)
    const login = username(input.username)
    const email = string(input.correo,'correo',3,254).trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400,'DATOS_INVALIDOS','Correo inválido.')
    const perfil = input.perfil ?? 'SOLICITANTE'
    if (!['CONSULTA','SOLICITANTE'].includes(perfil)) fail(400,'DATOS_INVALIDOS','Perfil inválido.')
    const verified = await clientes.validate(remoteId,identity)
    const temporary = randomSecret()
    const passwordHash = await security.hashPassword(temporary)
    const expires = new Date(Date.now()+config.password.temporaryMinutes*60000)
    const user = await db.transaction(async transaction=>{
      const actorId = await actores.internal(identity,transaction)
      const linked = await clientes.link(verified,transaction)
      const externalActorId = await actores.external(linked.id,login,transaction)
      const created = await Usuario.create({cliente_id:linked.id,actor_id:externalActorId,username_normalizado:login,
        correo:email,password_hash:passwordHash,debe_cambiar_password:true,password_temporal_expira_at:expires,
        perfil,creado_por_actor_id:actorId},{transaction})
      await auditoria.record(transaction,context,'USUARIO_EXTERNO_CREADO','usuario',created.id,
        {clientId:linked.id,actorId,detail:{perfil,wms_cliente_id:remoteId}})
      return userView(created)
    })
    return {usuario:user,password_temporal:temporary,password_temporal_expira_at:expires.toISOString()}
  }
  async function list(query) {
    const where = query.cliente_id === undefined ? {} : {cliente_id:positiveId(query.cliente_id)}
    const page = Number(query.page ?? 1)
    const limit = Number(query.limit ?? 25)
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      fail(400,'PAGINACION_INVALIDA','Paginación inválida.')
    }
    const {count,rows} = await Usuario.findAndCountAll({where,include:[{model:Cliente,as:'cliente',attributes:['nombre_presentacion'],required:true}],
      order:[['id','DESC']],limit,offset:(page-1)*limit})
    return {total:count,page,limit,data:rows.map(user=>({...userView(user),
      cliente_nombre:user.cliente.nombre_presentacion,creado_at:isoDate(user.creado_at)}))}
  }
  async function changeState(id,state,identity,context) {
    id = positiveId(id)
    if (!['ACTIVO','SUSPENDIDO'].includes(state)) fail(400,'ESTADO_INVALIDO','Estado admite ACTIVO o SUSPENDIDO.')
    return db.transaction(async transaction=>{
      const actorId = await actores.internal(identity,transaction)
      const user = await Usuario.findByPk(id,{transaction,lock:transaction.LOCK.UPDATE})
      if (!user) fail(404,'USUARIO_NO_EXISTE','El usuario no existe.')
      if (user.estado !== state) {
        const previous = user.estado
        await user.update({estado:state,version_credenciales:user.version_credenciales+1},{transaction})
        await sesiones.revokeForUser(id,'CAMBIO_ESTADO_CUENTA',transaction)
        await auditoria.record(transaction,context,'USUARIO_ESTADO_CAMBIADO','usuario',id,
          {clientId:user.cliente_id,actorId,detail:{anterior:previous,nuevo:state}})
      }
      return {id,estado:state}
    })
  }
  async function resetPassword(id,identity,context) {
    id = positiveId(id)
    const temporary = randomSecret()
    const hash = await security.hashPassword(temporary)
    const expires = new Date(Date.now()+config.password.temporaryMinutes*60000)
    await db.transaction(async transaction=>{
      const actorId = await actores.internal(identity,transaction)
      const user = await Usuario.findByPk(id,{transaction,lock:transaction.LOCK.UPDATE})
      if (!user) fail(404,'USUARIO_NO_EXISTE','El usuario no existe.')
      await user.update({password_hash:hash,debe_cambiar_password:true,password_temporal_expira_at:expires,
        version_credenciales:user.version_credenciales+1,bloqueado_hasta_at:null},{transaction})
      await sesiones.revokeForUser(id,'PASSWORD_RESTABLECIDA',transaction)
      await auditoria.record(transaction,context,'PASSWORD_RESTABLECIDA','usuario',id,{clientId:user.cliente_id,actorId})
    })
    return {id,password_temporal:temporary,password_temporal_expira_at:expires.toISOString(),debe_cambiar_password:true}
  }
  return {provision,list,changeState,resetPassword}
}
module.exports = { createUsuarioService }
