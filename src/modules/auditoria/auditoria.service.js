const { Op } = require('sequelize')

function createAuditoriaService({models}) {
  async function record(transaction,context,event,entity,id,extra={}) {
    return models.EventoAuditoria.create({
      cliente_id:extra.clientId ?? null,actor_id:extra.actorId ?? null,sesion_id:extra.sessionId ?? null,
      solicitud_id:extra.solicitudId ?? null,
      correlation_id:context.correlationId,codigo_evento:event,entidad_tipo:entity,entidad_id:String(id),
      detalle_interno:extra.detail ?? null,ip_origen:context.ip,navegador:context.userAgent,
    },{transaction})
  }
  async function recentLoginFailures(transaction,actorId,minutes) {
    return models.EventoAuditoria.count({where:{actor_id:actorId,codigo_evento:'LOGIN_FALLIDO',
      creado_at:{[Op.gte]:new Date(Date.now()-minutes*60000)}},transaction})
  }
  return {record,recentLoginFailures}
}
module.exports = { createAuditoriaService }
