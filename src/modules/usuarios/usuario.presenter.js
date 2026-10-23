const { bool } = require('../../utils/security')

function userView(user) {
  return {id:String(user.id),cliente_id:String(user.cliente_id),username:user.username_normalizado,
    correo:user.correo,perfil:user.perfil,estado:user.estado,debe_cambiar_password:bool(user.debe_cambiar_password)}
}
module.exports = { userView }
