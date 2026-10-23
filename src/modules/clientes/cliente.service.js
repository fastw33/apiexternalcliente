const { fail } = require('../../utils/errors')
const { positiveId,bool } = require('../../utils/security')

function createClienteService({db,wms,actores,auditoria}) {
  const {Cliente,Usuario,Sesion} = db.models
  const list = (query,identity)=>wms.listClients(query,identity.bearer)
  const validate = (id,identity)=>wms.validateClient(id,identity.bearer)
  async function link(verified,transaction) {
    await Cliente.findOrCreate({where:{wms_cliente_id:verified.wms_cliente_id},defaults:{
      nombre_presentacion:verified.nombre,habilitado:true,wms_activo_ultima_validacion:true,validado_wms_at:new Date(),
    },transaction})
    const client = await Cliente.findOne({where:{wms_cliente_id:verified.wms_cliente_id},transaction,lock:transaction.LOCK.UPDATE})
    if (!bool(client.habilitado)) fail(422,'CLIENTE_PORTAL_SUSPENDIDO','El cliente está suspendido en el portal.')
    await client.update({nombre_presentacion:verified.nombre,wms_activo_ultima_validacion:true,validado_wms_at:new Date()},{transaction})
    return client
  }
  async function changeState(id,enabled,identity,context) {
    id = positiveId(id)
    if (typeof enabled !== 'boolean') fail(400,'DATOS_INVALIDOS','habilitado debe ser booleano.')
    const linked = await Cliente.findByPk(id)
    if (!linked) fail(404,'CLIENTE_NO_EXISTE','El cliente no existe en el portal.')
    if (enabled) await validate(linked.wms_cliente_id,identity)
    await db.transaction(async transaction=>{
      const actorId = await actores.internal(identity,transaction)
      const client = await Cliente.findByPk(id,{transaction,lock:transaction.LOCK.UPDATE})
      const values = {habilitado:enabled}
      if (enabled) Object.assign(values,{wms_activo_ultima_validacion:true,validado_wms_at:new Date()})
      await client.update(values,{transaction})
      if (!enabled) {
        await Usuario.increment('version_credenciales',{where:{cliente_id:id},transaction})
        await Sesion.update({revocada_at:new Date(),motivo_revocacion:'CLIENTE_SUSPENDIDO'},
          {where:{cliente_id:id,revocada_at:null},transaction})
      }
      await auditoria.record(transaction,context,'CLIENTE_HABILITACION_CAMBIADA','cliente',id,
        {clientId:id,actorId,detail:{habilitado:enabled}})
    })
    return {id,habilitado:enabled}
  }
  return {list,validate,link,changeState}
}
module.exports = { createClienteService }
