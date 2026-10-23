const { randomSecret,isSecret } = require('../../utils/security')

function createDispositivoService({models,security}) {
  async function resolve(user,cookie,name,context,transaction) {
    let token = isSecret(cookie) ? cookie : null
    let device = token ? await models.Dispositivo.findOne({where:{cliente_id:user.cliente_id,usuario_id:user.id,
      identificador_hash:security.digest('device',token),revocado_at:null},transaction,lock:transaction.LOCK.UPDATE}) : null
    if (!device) {
      token = randomSecret()
      device = await models.Dispositivo.create({cliente_id:user.cliente_id,usuario_id:user.id,
        identificador_hash:security.digest('device',token),nombre:name,navegador:context.userAgent,ultimo_uso_at:new Date()},{transaction})
    } else {
      await device.update({ultimo_uso_at:new Date()},{transaction})
    }
    return {device:device.get({plain:true}),token}
  }
  return {resolve}
}
module.exports = { createDispositivoService }
