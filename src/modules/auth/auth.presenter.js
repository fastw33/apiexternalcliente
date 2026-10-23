const { isoDate } = require('../../utils/security')
const { userView } = require('../usuarios/usuario.presenter')

function sessionView(auth,security,terminos) {
  return {usuario:userView(auth),cliente:{id:String(auth.cliente_id),nombre:auth.cliente_nombre},
    sesion:{id:String(auth.sesion_id),tipo:auth.tipo,expira_at:isoDate(auth.expira_at)},
    dispositivo:{id:String(auth.dispositivo_id),nombre:auth.dispositivo_nombre},csrf_token:security.csrf(auth.token),
    terminos,habilitado_para_operar:auth.tipo === 'NORMAL' && terminos.aceptado}
}
module.exports = { sessionView }
