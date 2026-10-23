const { createHash } = require('node:crypto')
const { fail } = require('../../utils/errors')
const { string,isoDate } = require('../../utils/security')

function createTerminosService({db,actores,auditoria,sesiones}) {
  const {TerminosVersion,TerminosAceptacion} = db.models
  const current = transaction => TerminosVersion.findOne({order:[['id','DESC']],transaction})
  const documentView = document => ({version:document.version,titulo:document.titulo,contenido:document.contenido,
    contenido_sha256:document.contenido_sha256,publicado_at:isoDate(document.publicado_at)})
  async function publicDocument() {
    const document = await current()
    return {disponible:!!document,documento:document ? documentView(document) : null}
  }
  async function status(auth,transaction,document) {
    if (document === undefined) document = await current(transaction)
    const receipt = document ? await TerminosAceptacion.findOne({where:{terminos_id:document.id,
      cliente_id:auth.cliente_id,usuario_id:auth.id},transaction}) : null
    return {disponible:!!document,requerida:!receipt,version:document?.version ?? null,
      contenido_sha256:document?.contenido_sha256 ?? null,aceptado:!!receipt,
      autoriza_tratamiento_datos:!!receipt,aceptado_at:receipt ? isoDate(receipt.aceptado_at) : null}
  }
  async function get(auth) {
    const document = await current()
    return {...await status(auth,undefined,document),documento:document ? documentView(document) : null}
  }
  async function requireAcceptance(auth) {
    const terms = await status(auth)
    if (!terms.disponible) fail(403,'TERMINOS_NO_PUBLICADOS','Los términos del portal están pendientes de publicación.')
    if (terms.requerida) fail(403,'TERMINOS_REQUERIDOS','Debes aceptar los términos vigentes y autorizar el tratamiento de datos antes de operar.')
  }
  async function publish(input,identity,context) {
    const version = string(input.version,'version',1,80).trim()
    const title = string(input.titulo,'titulo',1,250).trim()
    const content = input.contenido
    if (!version || !title || typeof content !== 'string' || !content.trim() || content.length > 12000 ||
        /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(content) || Buffer.from(content,'utf8').toString('utf8') !== content) {
      fail(400,'DATOS_INVALIDOS','Versión, título y contenido son obligatorios. El contenido admite texto con párrafos.')
    }
    if (/\[[^\]\r\n]*PENDIENTE[^\]\r\n]*\]/i.test(content)) {
      fail(400,'TERMINOS_INCOMPLETOS','Completa los campos pendientes antes de publicar.')
    }
    return db.transaction(async transaction=>{
      const actorId = await actores.internal(identity,transaction)
      const document = await TerminosVersion.create({version,titulo:title,contenido:content,
        contenido_sha256:createHash('sha256').update(content,'utf8').digest('hex'),
        publicado_por_actor_id:actorId},{transaction})
      await auditoria.record(transaction,context,'TERMINOS_PUBLICADOS','terminos',document.id,
        {actorId,detail:{version,contenido_sha256:document.contenido_sha256}})
      return documentView(document)
    })
  }
  async function accept(auth,input,context) {
    if (input.acepto !== true || input.autoriza_tratamiento_datos !== true) {
      fail(400,'ACEPTACION_EXPLICITA_REQUERIDA','La aceptación de términos y la autorización de datos deben confirmarse explícitamente.')
    }
    const version = string(input.version,'version',1,80)
    const hash = string(input.contenido_sha256,'contenido_sha256',64,64)
    return db.transaction(async transaction=>{
      const fresh = await sesiones.load(auth.token,auth.deviceToken,transaction,true)
      const document = await current(transaction)
      if (!document) fail(403,'TERMINOS_NO_PUBLICADOS','Los términos del portal están pendientes de publicación.')
      if (document.version !== version || document.contenido_sha256 !== hash) {
        fail(409,'TERMINOS_CAMBIARON','Consulta y revisa la versión vigente antes de aceptar.')
      }
      const [receipt,created] = await TerminosAceptacion.findOrCreate({where:{usuario_id:fresh.id,terminos_id:document.id},
        defaults:{cliente_id:fresh.cliente_id,sesion_id:fresh.sesion_id,dispositivo_id:fresh.dispositivo_id,
          autoriza_tratamiento_datos:true,ip_origen:context.ip,navegador:context.userAgent,
          correlation_id:context.correlationId},transaction})
      if (created) await auditoria.record(transaction,context,'TERMINOS_ACEPTADOS','terminos_aceptacion',receipt.id,
        {clientId:fresh.cliente_id,actorId:fresh.actor_id,sessionId:fresh.sesion_id,
          detail:{version,contenido_sha256:hash,dispositivo_id:fresh.dispositivo_id,autoriza_tratamiento_datos:true}})
      return status(fresh,transaction,document)
    })
  }
  return {status,get,publicDocument,requireAcceptance,publish,accept}
}
module.exports = { createTerminosService }
