const { fail } = require('../../utils/errors')
const { clientId } = require('../../utils/security')
const { isUtf8 } = require('node:buffer')
const { movementsForClient } = require('./wms-movimientos')
const { createWmsDocuments } = require('./wms-documentos')
const { fileType } = require('../../modules/documentos/documento.catalog')

function createWms(config, { fetchImpl = fetch } = {}) {
  // Credencial privada: este flujo solo puede escribir cabeceras y líneas de lotes.
  const preloadAuth = Symbol('precargas')
  const productAuth = Symbol('productos-bodega')
  const operationAuth = Symbol('operaciones')
  const documentAuth = Symbol('documentos')
  async function get(
    path,
    bearer,
    { method = 'GET', body, allowMissing = false, service = false, binary = false } = {},
  ) {
    const preload = bearer === preloadAuth
    const product = bearer === productAuth
    const operation = bearer === operationAuth
    const document = bearer === documentAuth
    const automatic = preload || product || operation || document
    const multipart = body instanceof FormData
    const maxBytes = binary ? config.documents.maxFileBytes : config.wms.maxResponseBytes
    if (automatic) {
      bearer = undefined
      service = true
    }
    if (
      service &&
      (!config.wms.internalServiceKey ||
        (method !== 'GET' &&
          !(
            (method === 'PUT' && document && /^\/api\/cliente\/[^/]+\/documentos$/.test(path)) ||
            method === 'POST' &&
            ((preload && ['/api/lote', '/api/lote-producto'].includes(path)) ||
              (product && path === '/api/producto') ||
              (operation && path === '/api/alistamientos/externos'))
          )))
    )
      fail(
        503,
        'WMS_CONSULTA_NO_CONFIGURADA',
        'No está configurada la conexión de consulta con WMS.',
      )
    let response
    try {
      response = await fetchImpl(config.wms.baseUrl + path, {
        method,
        redirect: 'error',
        headers: {
          Accept: 'application/json',
          ...(body && !multipart ? { 'Content-Type': 'application/json' } : {}),
          ...(document && method === 'PUT' ? { 'x-preservar-documento-anterior': 'true' } : {}),
          ...(bearer ? { Authorization: bearer } : {}),
          ...(service
            ? { 'x-internal-service-key': config.wms.internalServiceKey }
            : {}),
        },
        ...(body ? { body: multipart ? body : JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(config.wms.timeoutMs),
      })
    } catch {
      fail(503, 'WMS_NO_DISPONIBLE', 'No fue posible consultar WMS.')
    }
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel()
      if (service)
        fail(
          503,
          'WMS_CONSULTA_RECHAZADA',
          'No fue posible autorizar la conexión con WMS.',
        )
      fail(401, 'WMS_SESION_RECHAZADA', 'WMS rechazó la sesión interna.')
    }
    if (response.status === 404) {
      if (document) {
        await response.body?.cancel()
        fail(404, 'DOCUMENTO_NO_EXISTE', 'El documento no está disponible para tu empresa.')
      }
      if (allowMissing) {
        await response.body?.cancel()
        return null
      }
      if (!service) {
        await response.body?.cancel()
        if (allowMissing) return null
        fail(404, 'CLIENTE_WMS_NO_EXISTE', 'El cliente no existe en WMS.')
      }
    }
    if (operation && [409, 422].includes(response.status)) {
      await response.body?.cancel()
      fail(
        409,
        'ALISTAMIENTO_NO_DISPONIBLE',
        'Genika no confirmó el alistamiento. Verifica las cantidades pendientes en otros alistamientos y la fecha programada.',
      )
    }
    if (!response.ok && !(service && response.status === 404)) {
      await response.body?.cancel()
      fail(502, 'WMS_ERROR', 'WMS no pudo completar la consulta.')
    }
    if (
      Number(response.headers.get('content-length')) >
      maxBytes
    ) {
      await response.body?.cancel()
      fail(
        502,
        'WMS_RESPUESTA_EXCESIVA',
        'WMS devolvió una respuesta demasiado grande.',
      )
    }
    const chunks = []
    let size = 0
    try {
      for await (const chunk of response.body) {
        size += chunk.length
        if (size > maxBytes)
          fail(
            502,
            'WMS_RESPUESTA_EXCESIVA',
            'WMS devolvió una respuesta demasiado grande.',
          )
        chunks.push(chunk)
      }
      const content = Buffer.concat(chunks, size)
      if (binary) return { buffer: content, ...fileType(content) }
      if (!isUtf8(content))
        fail(
          502,
          'WMS_RESPUESTA_INVALIDA',
          'WMS devolvió una respuesta inválida.',
        )
      const data = JSON.parse(content.toString('utf8'))
      if (service && response.status === 404) {
        if (data?.message === 'No se encontró inventario') return []
        fail(
          502,
          'WMS_RESPUESTA_INVALIDA',
          'No está disponible la consulta de inventario en WMS.',
        )
      }
      return data
    } catch (error) {
      if (error.status) throw error
      fail(
        502,
        'WMS_RESPUESTA_INVALIDA',
        'WMS devolvió una respuesta inválida.',
      )
    }
  }
  const active = (client) =>
    client.Activo === true || client.Activo === 1 || client.Activo === '1'
  function validClient(client) {
    if (
      !client ||
      typeof client.id_Cliente !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,249}$/.test(client.id_Cliente) ||
      typeof client.Nombre !== 'string' ||
      !client.Nombre.trim() ||
      client.Nombre.length > 250 ||
      /[\u0000-\u001F\u007F]/.test(client.Nombre) ||
      ![true, false, 1, 0, '1', '0'].includes(client.Activo)
    ) {
      fail(
        502,
        'WMS_RESPUESTA_INVALIDA',
        'WMS devolvió datos de cliente inválidos.',
      )
    }
    return client
  }
  const clientView = (client) => ({
    wms_cliente_id: String(client.id_Cliente),
    nombre: client.Nombre,
    activo: true,
  })
  async function listClients(query, bearer) {
    const page = Number(query.page ?? 1)
    const limit = Number(query.limit ?? 25)
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      page > 100000 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    ) {
      fail(400, 'PAGINACION_INVALIDA', 'Paginación inválida.')
    }
    const result = await get(`/api/cliente?page=${page}&limit=${limit}`, bearer)
    if (
      !Array.isArray(result?.data) ||
      result.data.length > limit ||
      !Number.isSafeInteger(Number(result.total)) ||
      Number(result.total) < result.data.length
    ) {
      fail(
        502,
        'WMS_RESPUESTA_INVALIDA',
        'WMS no devolvió una lista válida de clientes.',
      )
    }
    result.data.forEach(validClient)
    return {
      data: result.data.filter(active).map(clientView),
      page,
      limit,
      total_wms: Number(result.total),
      has_more: page * limit < Number(result.total),
    }
  }
  async function validateClient(id, bearer) {
    id = clientId(id)
    const data = validClient(
      await get(`/api/cliente/${encodeURIComponent(id)}`, bearer),
    )
    if (
      String(data?.id_Cliente) !== id ||
      typeof data.Nombre !== 'string' ||
      !data.Nombre.trim()
    ) {
      fail(
        502,
        'WMS_RESPUESTA_INVALIDA',
        'La respuesta no corresponde al cliente solicitado.',
      )
    }
    if (!active(data))
      fail(422, 'CLIENTE_WMS_INACTIVO', 'El cliente está inactivo en WMS.')
    // La respuesta actual trae documentos y personal: no se propagan ni almacenan.
    return {
      wms_cliente_id: id,
      nombre: data.Nombre.slice(0, 250),
      activo: true,
    }
  }
  function validProduct(value) {
    const text = [
      'Id_producto',
      'Nombre',
      'Referencia',
      'Tipo',
      'Unidad_de_medida',
    ]
    if (
      !value ||
      text.some(
        (key) =>
          typeof value[key] !== 'string' ||
          !value[key].trim() ||
          value[key].length > 250,
      ) ||
      ['Alto', 'Ancho', 'Largo'].some(
        (key) =>
          !['number', 'string'].includes(typeof value[key]) ||
          String(value[key]).trim() === '' ||
          !Number.isFinite(Number(value[key])) ||
          Number(value[key]) < 0,
      )
    ) {
      fail(
        502,
        'WMS_RESPUESTA_INVALIDA',
        'WMS devolvió una ficha de producto inválida.',
      )
    }
    return Object.fromEntries(
      [...text, 'Alto', 'Ancho', 'Largo'].map((key) => [key, value[key]]),
    )
  }
  async function listProducts(bearer) {
    const result = await get('/api/producto', bearer)
    if (!Array.isArray(result))
      fail(
        502,
        'WMS_RESPUESTA_INVALIDA',
        'WMS no devolvió una lista de productos válida.',
      )
    return result.map(validProduct)
  }
  async function getProduct(id, bearer) {
    const result = await get(
      `/api/producto/${encodeURIComponent(id)}`,
      bearer,
      { allowMissing: true },
    )
    if (!result) return null
    const product = validProduct(result)
    if (product.Id_producto !== id)
      fail(
        502,
        'WMS_RESPUESTA_INVALIDA',
        'La ficha devuelta no corresponde al producto consultado.',
      )
    return product
  }
  async function createProduct(body, bearer) {
    return validProduct(
      await get('/api/producto', bearer, { method: 'POST', body }),
    )
  }
  async function validateProductPrefix(prefix, type, bearer) {
    const result = await get(`/api/prefijo?activo=1&pageSize=1000`, bearer)
    if (!Array.isArray(result?.data))
      fail(
        502,
        'WMS_RESPUESTA_INVALIDA',
        'No fue posible verificar la maestra de prefijos.',
      )
    const entry = result.data.find(
      (item) => item.prefijo === prefix && [true, 1, '1'].includes(item.activo),
    )
    if (
      !entry ||
      (type === 'RS'
        ? !['RS_ESPECIFICO', 'RS_GENERICO'].includes(entry.tipo)
        : entry.tipo !== 'BODEGA_GENERICO')
    ) {
      fail(
        409,
        'PREFIJO_WMS_NO_DISPONIBLE',
        'El prefijo ya no está activo o no corresponde al tipo en WMS.',
      )
    }
  }
  const api = {
    documents: () => {
      const documents = createWmsDocuments({ get, auth: documentAuth })
      return {
        list: (id) => documents.list(clientId(id)),
        file: (id, type) => documents.file(clientId(id), type),
        update: (id, type, buffer, mime) => documents.update(clientId(id), type, buffer, mime),
      }
    },
    movements: async (id) => {
      id = clientId(id)
      const result = await get('/api/historial/con-lote', undefined, { service: true })
      return movementsForClient(result, id)
    },
    inventory: async (id) => {
      id = clientId(id)
      const result = await get('/api/inventario/resumen', undefined, {
        service: true,
      })
      if (!Array.isArray(result))
        fail(
          502,
          'WMS_RESPUESTA_INVALIDA',
          'WMS no devolvió una consulta de inventario válida.',
        )
      // El resumen contiene posiciones y datos de terceros: no salen de esta integración.
      return result
        .filter((row) => row?.id_Cliente === id)
        .map((row) => {
          if (
            row.Id_proveedor ||
            [
              'Id_lote_producto',
              'Id_lote',
              'Id_producto',
              'Nombre_Producto',
              'Unidad_de_medida',
            ].some(
              (key) =>
                typeof row[key] !== 'string' ||
                !row[key].trim() ||
                row[key].length > 250,
            ) ||
            !['string', 'number'].includes(typeof row.Cantidad_Inventario) ||
            String(row.Cantidad_Inventario).trim() === '' ||
            !Number.isFinite(Number(row.Cantidad_Inventario))
          )
            fail(
              502,
              'WMS_RESPUESTA_INVALIDA',
              'WMS devolvió existencias con datos incompletos o titularidad ambigua.',
            )
          return {
            inventario_id: row.Id_inventario,
            lote_producto_id: row.Id_lote_producto,
            lote_id: row.Id_lote,
            producto_id: row.Id_producto,
            nombre: row.Nombre_Producto,
            referencia:
              typeof row.Referencia === 'string' ? row.Referencia : '',
            unidad_medida: row.Unidad_de_medida,
            cantidad: String(row.Cantidad_Inventario),
            actualizado_at:
              row.Fecha_ultimo_registro &&
              Number.isFinite(new Date(row.Fecha_ultimo_registro).getTime())
                ? new Date(row.Fecha_ultimo_registro).toISOString()
                : null,
          }
        })
    },
    listLots: async (bearer) => {
      const result = await get('/api/lote', bearer)
      if (
        !Array.isArray(result) ||
        result.some((row) => typeof row.Id_lote !== 'string' || !row.Id_lote)
      )
        fail(
          502,
          'WMS_RESPUESTA_INVALIDA',
          'WMS no devolvió una lista de lotes válida.',
        )
      return result.map((row) => ({ Id_lote: row.Id_lote }))
    },
    getLot: async (id, bearer) => {
      const result = await get(`/api/lote/${encodeURIComponent(id)}`, bearer, {
        allowMissing: true,
      })
      if (!result) return null
      if (result.Id_lote !== id || typeof result.Comentarios !== 'string')
        fail(
          502,
          'WMS_RESPUESTA_INVALIDA',
          'WMS no devolvió el lote solicitado.',
        )
      return { Id_lote: result.Id_lote, Comentarios: result.Comentarios }
    },
    createLot: (body, bearer) =>
      get('/api/lote', bearer, { method: 'POST', body }),
    listLotProducts: async (id, bearer) => {
      const result = await get('/api/lote-producto', bearer)
      if (!Array.isArray(result))
        fail(
          502,
          'WMS_RESPUESTA_INVALIDA',
          'WMS no devolvió las líneas del lote.',
        )
      return result
        .filter((row) => row.id_lote === id)
        .map((row) => {
          const client = row.id_Cliente ?? row.id_cliente ?? null
          if (
            typeof row.id_lote_producto !== 'string' ||
            !row.id_lote_producto ||
            typeof row.id_producto !== 'string' ||
            !['string', 'number'].includes(typeof row.Cantidad) ||
            !Number.isFinite(Number(row.Cantidad)) ||
            Number(row.Cantidad) <= 0 ||
            (client !== null && typeof client !== 'string') ||
            (row.id_Cliente != null &&
              row.id_cliente != null &&
              row.id_Cliente !== row.id_cliente)
          )
            fail(
              502,
              'WMS_RESPUESTA_INVALIDA',
              'WMS devolvió una línea de lote inválida.',
            )
          return {
            id_lote_producto: row.id_lote_producto,
            id_lote: row.id_lote,
            id_producto: row.id_producto,
            id_cliente: client,
            id_proveedor: row.id_proveedor ?? null,
            Cantidad: row.Cantidad,
          }
        })
    },
    createLotProduct: (body, bearer) =>
      get('/api/lote-producto', bearer, { method: 'POST', body }),
    listClients,
    validateClient,
    listProducts,
    getProduct,
    createProduct,
    validateProductPrefix,
  }
  api.preloads = () => ({
    validateClient: (id) => validateClient(id, preloadAuth),
    getProduct: (id) => getProduct(id, preloadAuth),
    listLots: () => api.listLots(preloadAuth),
    getLot: (id) => api.getLot(id, preloadAuth),
    createLot: (body) => api.createLot(body, preloadAuth),
    listLotProducts: (id) => api.listLotProducts(id, preloadAuth),
    createLotProduct: (body) => api.createLotProduct(body, preloadAuth),
  })
  function operationView(row) {
    if (
      !row ||
      !Number.isSafeInteger(row.id_alistamiento) ||
      row.id_alistamiento < 1 ||
      typeof row.id_cliente !== 'string' ||
      !row.id_cliente ||
      row.id_cliente.length > 250 ||
      typeof row.request_id !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(row.request_id) ||
      !['ABIERTO', 'CANCELADO', 'DESPACHADO'].includes(row.estado) ||
      !['PENDIENTE', 'EN_PREPARACION', 'LISTO'].includes(row.etapa)
    )
      fail(
        502,
        'WMS_RESPUESTA_INVALIDA',
        'WMS devolvió un estado de operación inválido.',
      )
    return {
      request_id: row.request_id,
      id_alistamiento: row.id_alistamiento,
      id_cliente: row.id_cliente,
      estado: row.estado,
      etapa: row.etapa,
    }
  }
  api.operations = () => ({
    cancel: (id,bearer,motivo) => {
      if(!Number.isSafeInteger(id)||id<1||typeof bearer!=='string'||!bearer)
        fail(400,'CANCELACION_INVALIDA','No fue posible autorizar la cancelación.')
      return get(`/api/alistamientos/${id}/cancelar`,bearer,{method:'PATCH',body:{motivo}})
    },
    validateClient: (id) => validateClient(id, operationAuth),
    create: async (body) =>
      operationView(
        await get('/api/alistamientos/externos', operationAuth, {
          method: 'POST',
          body,
        }),
      ),
    obtain: async (uuid) => {
      const row = await get(
        `/api/alistamientos/externos/${encodeURIComponent(uuid)}`,
        operationAuth,
        { allowMissing: true },
      )
      if (!row) return null
      const result = operationView(row)
      if (result.request_id !== uuid)
        fail(502, 'WMS_RESPUESTA_INVALIDA', 'WMS devolvió otra operación.')
      return result
    },
    statuses: async (ids, id) => {
      const rows = []
      for (let index=0; index<ids.length; index+=25) {
        const batch=ids.slice(index,index+25)
        const result=await get(
          `/api/alistamientos/externos?${new URLSearchParams({ id_cliente: id, request_ids: batch.join(',') })}`,
          operationAuth,
        )
        if (!Array.isArray(result) || result.length > batch.length)
          fail(502,'WMS_RESPUESTA_INVALIDA','WMS no devolvió una lista de operaciones válida.')
        rows.push(...result)
      }
      const result = rows.map(operationView)
      if (
        new Set(result.map((row) => row.request_id)).size !== result.length ||
        result.some(
          (row) => row.id_cliente !== id || !ids.includes(row.request_id),
        )
      )
        fail(
          502,
          'WMS_RESPUESTA_INVALIDA',
          'WMS devolvió operaciones ajenas a la consulta.',
        )
      return result
    },
  })
  api.products = () => ({
    listProducts: async () =>
      (await listProducts(productAuth)).filter((row) => row.Tipo === 'Bodega'),
    getProduct: async (id) => {
      const row = await getProduct(id, productAuth)
      if (row && row.Tipo !== 'Bodega')
        fail(404, 'PRODUCTO_NO_EXISTE', 'El producto Bodega no existe.')
      return row
    },
    validateProductPrefix: (prefix, type) => {
      if (type !== 'Bodega')
        fail(
          400,
          'TIPO_NO_PERMITIDO',
          'Solo se pueden crear productos tipo Bodega.',
        )
      return validateProductPrefix(prefix, type, productAuth)
    },
    createProduct: (body) => {
      if (body.Tipo !== 'Bodega')
        fail(
          400,
          'TIPO_NO_PERMITIDO',
          'Solo se pueden crear productos tipo Bodega.',
        )
      return createProduct(body, productAuth)
    },
  })
  return api
}
module.exports = { createWms }
