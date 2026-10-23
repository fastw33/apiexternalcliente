const { createHash } = require('node:crypto')
const { fail } = require('../../utils/errors')
const { bool } = require('../../utils/security')
const { assertWriter, freshWriter } = require('../../utils/customerAccess')
const { pagination } = require('../../utils/businessValidation')
const { normalize } = require('../productos/producto-similitud')
const { catalog, tipo, fileType, formatos } = require('./documento.catalog')
function createDocumentoService({
  config,
  db,
  wms,
  sesiones,
  terminos,
  auditoria,
}) {
  const { Cliente } = db.models
  const integration = () => wms.documents()
  async function client(auth, transaction) {
    const row = await Cliente.findByPk(
      auth.cliente_id,
      transaction ? { transaction, lock: transaction.LOCK.UPDATE } : {},
    )
    if (
      !row ||
      !bool(row.habilitado) ||
      !bool(row.wms_activo_ultima_validacion)
    )
      fail(
        403,
        'CLIENTE_DESHABILITADO',
        'El cliente no está habilitado para consultar documentos.',
      )
    return row
  }
  async function list(auth, query = {}) {
    const { buscar, estado, ...paging } = query
    const { page, limit } = pagination(paging)
    const owner = await client(auth)
    const result = await integration().list(owner.wms_cliente_id)
    const search = normalize(buscar)
    const rows = result.data
      .filter(
        (row) =>
          (!estado || row.estado === estado) &&
          (!search ||
            [row.nombre, row.nombre_archivo].some((value) =>
              normalize(value).includes(search),
            )),
      )
      .map(({ path, ...row }) => row)
    return {
      data: rows.slice((page - 1) * limit, page * limit),
      total: rows.length,
      page,
      limit,
      actualizado_at: result.actualizado_at,
      permite_carga: auth.perfil === 'SOLICITANTE',
      tipos_disponibles: Object.entries(catalog)
        .filter(([type]) => !result.data.some((row) => row.tipo === type))
        .map(([tipo, nombre]) => ({ tipo, nombre })),
      formatos,
      max_archivo_bytes: config.documents.maxFileBytes,
    }
  }
  const audit = (auth, detail = {}) => ({
    clientId: auth.cliente_id,
    actorId: auth.actor_id,
    sessionId: auth.sesion_id,
    detail: { dispositivo_id: auth.dispositivo_id, ...detail },
  })
  async function file(auth, type, context) {
    tipo(type)
    const owner = await client(auth)
    const result = await integration().file(owner.wms_cliente_id, type)
    await auditoria.record(
      null,
      context,
      'DOCUMENTO_CONSULTADO',
      'documento_cliente',
      type,
      audit(auth),
    )
    return result
  }
  async function update(auth, type, buffer, mime, context) {
    assertWriter(auth)
    tipo(type)
    if (
      !Buffer.isBuffer(buffer) ||
      !buffer.length ||
      buffer.length > config.documents.maxFileBytes
    )
      fail(
        413,
        'DOCUMENTO_TAMANO_INVALIDO',
        'El archivo supera el tamaño permitido o está vacío.',
      )
    if (fileType(buffer).mime !== mime)
      fail(
        415,
        'DOCUMENTO_FORMATO_INVALIDO',
        'El contenido no corresponde al formato del archivo.',
      )
    await client(auth)
    await auditoria.record(
      null,
      context,
      'DOCUMENTO_ACTUALIZACION_SOLICITADA',
      'documento_cliente',
      type,
      audit(auth, {
        contenido_sha256: createHash('sha256').update(buffer).digest('hex'),
        tamano_bytes: buffer.length,
      }),
    )
    return db.transaction(async (transaction) => {
      const fresh = await freshWriter(auth, transaction, { sesiones, terminos })
      const owner = await client(fresh, transaction)
      const result = await integration().update(
        owner.wms_cliente_id,
        type,
        buffer,
        mime,
      )
      await auditoria.record(
        transaction,
        context,
        result.anterior === null
          ? 'DOCUMENTO_CARGADO'
          : 'DOCUMENTO_ACTUALIZADO',
        'documento_cliente',
        type,
        audit(fresh, {
          anterior_wms: result.anterior,
          actual_wms: result.actual,
          contenido_sha256: createHash('sha256').update(buffer).digest('hex'),
          tamano_bytes: buffer.length,
        }),
      )
      return { actualizado: true }
    })
  }
  return { list, file, update }
}
module.exports = { createDocumentoService }
