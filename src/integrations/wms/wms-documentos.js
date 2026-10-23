const { fail } = require('../../utils/errors')
const {
  catalog,
  tipo,
  fileType,
} = require('../../modules/documentos/documento.catalog')
const invalid = () =>
  fail(
    502,
    'DOCUMENTOS_WMS_INVALIDOS',
    'No fue posible verificar los documentos de tu empresa en WMS.',
  )
function documentRows(data, id) {
  if (data?.clienteId !== id || !Array.isArray(data.archivos)) invalid()
  const seen = new Set()
  return data.archivos
    .filter((row) => Object.hasOwn(catalog, row?.campo))
    .map((row) => {
      const prefix = '/uploads/clientes/cliente-' + id + '/'
      if (
        seen.has(row.campo) ||
        typeof row.url !== 'string' ||
        !row.url.startsWith(prefix)
      )
        invalid()
      const name = row.url.slice(prefix.length)
      // El destino lo decide WMS y debe estar dentro de la carpeta exacta del cliente.
      if (
        !/^[A-Za-z0-9_-][A-Za-z0-9_. -]{0,249}\.(pdf|png|jpg|jpeg)$/i.test(
          name,
        ) ||
        name.includes('..')
      )
        invalid()
      seen.add(row.campo)
      return {
        tipo: row.campo,
        nombre: catalog[row.campo],
        nombre_archivo: name,
        estado: 'ADJUNTO',
        path: row.url,
      }
    })
}
function createWmsDocuments({ get, auth }) {
  async function list(id) {
    const result = await get(
      '/api/cliente/' + encodeURIComponent(id) + '/documentos',
      auth,
    )
    const rows = documentRows(result, id)
    return {
      data: rows,
      actualizado_at:
        result.fecha_actualizacion &&
        Number.isFinite(Date.parse(result.fecha_actualizacion))
          ? new Date(result.fecha_actualizacion).toISOString()
          : null,
    }
  }
  async function file(id, type) {
    tipo(type)
    const row = (await list(id)).data.find((row) => row.tipo === type)
    if (!row)
      fail(
        404,
        'DOCUMENTO_NO_EXISTE',
        'El documento no está disponible para tu empresa.',
      )
    const result = await get(row.path, auth, { binary: true })
    return { ...result, filename: type + '.' + result.extension }
  }
  async function update(id, type, buffer, mime) {
    tipo(type)
    const previous = (await list(id)).data.find((row) => row.tipo === type)
    const format = fileType(buffer)
    if (format.mime !== mime)
      fail(
        415,
        'DOCUMENTO_FORMATO_INVALIDO',
        'El contenido no corresponde al formato del archivo.',
      )
    const body = new FormData()
    body.append(
      type,
      new Blob([buffer], { type: format.mime }),
      type + '.' + format.extension,
    )
    const result = await get(
      '/api/cliente/' + encodeURIComponent(id) + '/documentos',
      auth,
      { method: 'PUT', body },
    )
    const rows = documentRows(
      { clienteId: result?.cliente?.id_Cliente, archivos: result?.archivos },
      id,
    )
    const current = rows.find((row) => row.tipo === type)
    if (!current || current.path === previous?.path) invalid()
    return { anterior: previous?.path ?? null, actual: current.path }
  }
  return { list, file, update }
}
module.exports = { createWmsDocuments, documentRows }
