function createActorService({models}) {
  async function internal(identity,transaction) {
    const [actor] = await models.Actor.findOrCreate({where:{wms_usuario_id:identity.id},
      defaults:{tipo:'INTERNO',wms_personal_id:identity.personalId,nombre_presentacion:identity.name},transaction})
    await actor.update({wms_personal_id:identity.personalId,nombre_presentacion:identity.name},{transaction})
    return String(actor.id)
  }
  async function external(clientId,name,transaction) {
    const actor = await models.Actor.create({tipo:'CLIENTE',cliente_id:clientId,nombre_presentacion:name},{transaction})
    return String(actor.id)
  }
  return {internal,external}
}
module.exports = { createActorService }
