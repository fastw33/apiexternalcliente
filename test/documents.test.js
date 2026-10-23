const { test } = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')
const { IncomingMessage, ServerResponse } = require('node:http')
const { Duplex } = require('node:stream')
const { randomUUID } = require('node:crypto')
const { createWms } = require('../src/integrations/wms/wms.client')
const { documentRows } = require('../src/integrations/wms/wms-documentos')
const {
  createDocumentoService,
} = require('../src/modules/documentos/documento.service')
const {
  createDocumentoRoutes,
} = require('../src/modules/documentos/documento.routes')
const {
  createDocumentoController,
} = require('../src/modules/documentos/documento.controller')
const { createAuthMiddleware } = require('../src/middlewares/auth.middleware')
const {
  beforeBody,
  afterBody,
} = require('../src/middlewares/requestGuard.middleware')
const { AppError, createErrorHandler } = require('../src/utils/errors')
const config = {
  wms: {
    baseUrl: 'http://wms.invalid',
    timeoutMs: 1000,
    maxResponseBytes: 8192,
    internalServiceKey: 'fixture-sin-valor-real',
  },
  documents: { maxFileBytes: 1024 },
}
const pdf = Buffer.from('%PDF-1.4\nfixture-archivo-solo-memoria\n%%EOF')
function metadata(id) {
  return {
    clienteId: id,
    archivos: [
      {
        campo: 'rut',
        nombre: 'IGNORAR',
        url: '/uploads/clientes/cliente-' + id + '/rut-1.pdf',
      },
    ],
    fecha_actualizacion: '2026-10-20T17:00:00Z',
    documentosAdicionales: [{ privado: 'NO-PROPAGAR' }],
  }
}
function remote() {
  const calls = [],
    data = new Map([
      ['A', metadata('A')],
      ['B', metadata('B')],
    ])
  const wms = createWms(config, {
    fetchImpl: async (url, options) => {
      calls.push({ url, options })
      assert.equal(
        options.headers['x-internal-service-key'],
        config.wms.internalServiceKey,
      )
      assert.equal(options.headers.Authorization, undefined)
      assert.equal(options.redirect, 'error')
      const path = new URL(url).pathname
      const id = /^\/api\/cliente\/([AB])\/documentos$/.exec(path)?.[1]
      if (id && options.method === 'GET') return Response.json(data.get(id))
      if (id && options.method === 'PUT') {
        assert.equal(options.headers['x-preservar-documento-anterior'], 'true')
        assert.equal(options.headers['Content-Type'], undefined)
        assert.ok(options.body instanceof FormData)
        const keys = [...options.body.keys()]
        assert.equal(keys.length, 1)
        assert.ok(['rut', 'camara_comercio'].includes(keys[0]))
        const field = keys[0]
        const file = options.body.get(field)
        assert.equal(file.type, 'application/pdf')
        assert.deepEqual(Buffer.from(await file.arrayBuffer()), pdf)
        const current = structuredClone(data.get(id))
        const row = current.archivos.find((row) => row.campo === field)
        const url = '/uploads/clientes/cliente-' + id + '/' + field + '-2.pdf'
        if (row) row.url = url
        else
          current.archivos.push({ campo: field, nombre: field + '-2.pdf', url })
        data.set(id, current)
        return Response.json({
          cliente: { id_Cliente: id },
          archivos: current.archivos,
        })
      }
      if (/^\/uploads\/clientes\/cliente-[AB]\/rut-[12]\.pdf$/.test(path))
        return new Response(pdf, {
          headers: { 'Content-Type': 'application/pdf' },
        })
      assert.fail('Petición remota no autorizada: ' + path)
    },
  })
  return { wms, calls, data }
}
test('Documentos WMS: propiedad exacta, ruta fija, lectura en memoria y actualización sin DELETE', async () => {
  const { wms, calls } = remote(),
    api = wms.documents()
  assert.equal((await api.list('A')).data[0].tipo, 'rut')
  assert.deepEqual((await api.file('A', 'rut')).buffer, pdf)
  const updated = await api.update('A', 'rut', pdf, 'application/pdf')
  assert.match(updated.anterior, /rut-1\.pdf$/)
  assert.match(updated.actual, /rut-2\.pdf$/)
  assert.ok(calls.every((call) => ['GET', 'PUT'].includes(call.options.method)))
  const created = await api.update(
    'A',
    'camara_comercio',
    pdf,
    'application/pdf',
  )
  assert.equal(created.anterior, null)
  assert.match(created.actual, /camara_comercio-2\.pdf$/)
  assert.equal(
    (await api.list('B')).data.some((row) => row.tipo === 'camara_comercio'),
    false,
  )
  assert.throws(() => api.file('../B', 'rut'), { status: 400 })
  await assert.rejects(api.file('A', 'lista_clinton'), { status: 400 })
})
test('Documentos WMS: bloquea SSRF, traversal, duplicados, titularidad ajena y respuestas inválidas', () => {
  for (const url of [
    'https://otro.invalid/rut.pdf',
    '/uploads/clientes/cliente-B/rut.pdf',
    '/uploads/clientes/cliente-A/../rut.pdf',
    '/uploads/clientes/cliente-A/%2e%2e.pdf',
    '/uploads/clientes/cliente-A/sub/rut.pdf',
    '/uploads/clientes/cliente-A/rut.html',
  ])
    assert.throws(
      () =>
        documentRows(
          { ...metadata('A'), archivos: [{ campo: 'rut', url }] },
          'A',
        ),
      { status: 502 },
    )
  assert.throws(() => documentRows(metadata('B'), 'A'), { status: 502 })
  assert.throws(
    () =>
      documentRows(
        {
          ...metadata('A'),
          archivos: [...metadata('A').archivos, ...metadata('A').archivos],
        },
        'A',
      ),
    { status: 502 },
  )
  assert.deepEqual(
    documentRows(
      {
        ...metadata('A'),
        archivos: [{ campo: 'lista_clinton', url: '/interno.pdf' }],
      },
      'A',
    ),
    [],
  )
})
test('Documentos WMS: valida tamaño y firma del archivo; errores no simulan lista vacía', async () => {
  const apiFor = (response) =>
    createWms(config, { fetchImpl: async () => response() }).documents()
  for (const status of [401, 403, 404, 500])
    await assert.rejects(
      apiFor(() => Response.json({}, { status })).list('A'),
      { status: status === 404 ? 404 : status < 404 ? 503 : 502 },
    )
  for (const bytes of [
    Buffer.from('<html>ataque</html>'),
    Buffer.alloc(1025),
  ]) {
    const api = createWms(config, {
      fetchImpl: async (url) =>
        url.includes('/api/cliente/')
          ? Response.json(metadata('A'))
          : new Response(bytes),
    }).documents()
    await assert.rejects(api.file('A', 'rut'), {
      status: bytes.length > 1024 ? 502 : 415,
    })
  }
})
function fixture() {
  const r = remote(),
    events = [],
    auth = {
      A: {
        id: '11',
        cliente_id: '1',
        actor_id: '11',
        sesion_id: '21',
        dispositivo_id: '31',
        perfil: 'SOLICITANTE',
        tipo: 'NORMAL',
      },
      B: {
        id: '12',
        cliente_id: '2',
        actor_id: '12',
        sesion_id: '22',
        dispositivo_id: '32',
        perfil: 'SOLICITANTE',
        tipo: 'NORMAL',
      },
      reader: {
        id: '13',
        cliente_id: '1',
        actor_id: '13',
        sesion_id: '23',
        dispositivo_id: '33',
        perfil: 'CONSULTA',
        tipo: 'NORMAL',
      },
    }
  for (const [key, value] of Object.entries(auth))
    Object.assign(value, {
      token: key[0].repeat(43),
      deviceToken: key[0].repeat(43),
    })
  let terms = true
  const sesiones = {
    authenticate: async (token) => {
      const identity = Object.values(auth).find((row) => row.token === token)
      if (!identity)
        throw new AppError(401, 'SESION_INVALIDA', 'Sesión no válida')
      return identity
    },
    load: async (token) =>
      Object.values(auth).find((row) => row.token === token),
  }
  const terminos = {
    requireAcceptance: async () => {
      if (!terms)
        throw new AppError(403, 'TERMINOS_REQUERIDOS', 'Acepta los términos')
    },
    status: async () => ({ disponible: true, aceptado: terms }),
  }
  const service = createDocumentoService({
    config,
    wms: r.wms,
    sesiones,
    terminos,
    auditoria: {
      record: async (...event) => {
        events.push(event)
      },
    },
    db: {
      models: {
        Cliente: {
          findByPk: async (id) => ({
            id,
            wms_cliente_id: id === '1' ? 'A' : 'B',
            habilitado: true,
            wms_activo_ultima_validacion: true,
          }),
        },
      },
      transaction: (fn) => fn({ LOCK: { UPDATE: 'UPDATE' } }),
    },
  })
  const middleware = createAuthMiddleware({
    security: { csrf: () => 'c'.repeat(43) },
    sesiones,
    terminos,
    cookies: {
      sessionToken: (req) => auth[req.headers['x-fixture']]?.token,
      deviceToken: (req) => auth[req.headers['x-fixture']]?.deviceToken,
    },
  })
  const app = express()
  app.set('query parser', 'simple')
  const http = {
    maxUrlLength: 2048,
    maxQueryKeys: 10,
    maxDepth: 8,
    maxKeys: 128,
  }
  app.use((req, res, next) => {
    req.context = {
      correlationId: randomUUID(),
      ip: '192.0.2.1',
      userAgent: 'fixture',
    }
    next()
  })
  app.use(
    beforeBody(http),
    express.json({ limit: 128, inflate: false }),
    afterBody(http),
  )
  app.use(
    '/api/documentos',
    createDocumentoRoutes({
      config,
      controller: createDocumentoController(service),
      middleware,
    }),
  )
  app.use((req, res) => res.status(404).json({ code: 'RUTA_NO_EXISTE' }))
  app.use(createErrorHandler({ warn() {}, error() {} }))
  return {
    app,
    events,
    ...r,
    revokeTerms() {
      terms = false
    },
  }
}
function request(
  app,
  path,
  {
    method = 'GET',
    key = 'A',
    csrf = true,
    body,
    mime = 'application/pdf',
  } = {},
) {
  return new Promise((resolve, reject) => {
    const chunks = [],
      socket = new Duplex({
        read() {},
        write(chunk, encoding, callback) {
          chunks.push(Buffer.from(chunk))
          callback()
        },
      })
    socket.remoteAddress = '127.0.0.1'
    const req = new IncomingMessage(socket)
    req.method = method
    req.url = path
    req.httpVersion = '1.1'
    req.headers = {
      host: 'localhost',
      ...(key ? { 'x-fixture': key } : {}),
      ...(csrf ? { 'x-csrf-token': 'c'.repeat(43) } : {}),
      ...(body
        ? { 'content-type': mime, 'content-length': String(body.length) }
        : {}),
    }
    req.rawHeaders = Object.entries(req.headers).flat()
    const res = new ServerResponse(req)
    res.assignSocket(socket)
    res.on('error', reject)
    res.on('finish', () => {
      const raw = Buffer.concat(chunks),
        split = raw.indexOf('\r\n\r\n'),
        content = raw.subarray(split + 4)
      const headers = raw.subarray(0, split).toString('utf8')
      resolve({
        status: res.statusCode,
        headers,
        buffer: content,
        data: /application\/json/.test(headers)
          ? JSON.parse(content.toString())
          : null,
      })
      socket.destroy()
    })
    if (body) req.push(body)
    req.push(null)
    req.complete = true
    app.handle(req, res)
  })
}
test('Documentos HTTP: sesión, titularidad, consulta, descarga sin rutas, actualización auditada y ausencia de DELETE', async () => {
  const f = fixture()
  const view = await request(f.app, '/api/documentos?page=1&limit=25')
  assert.equal(view.status, 200)
  assert.equal(view.data.total, 1)
  assert.ok(
    !/uploads|cliente-A|path|url|NO-PROPAGAR/.test(JSON.stringify(view.data)),
  )
  assert.equal(
    (await request(f.app, '/api/documentos', { key: null })).status,
    401,
  )
  assert.equal(
    (await request(f.app, '/api/documentos?cliente_id=2')).status,
    400,
  )
  assert.equal(
    (await request(f.app, '/api/documentos', { key: 'reader' })).data
      .permite_carga,
    false,
  )
  const file = await request(f.app, '/api/documentos/rut/archivo', { key: 'B' })
  assert.equal(file.status, 200)
  assert.deepEqual(file.buffer, pdf)
  assert.match(file.headers, /Cache-Control: private, no-store/i)
  assert.match(f.calls.at(-1).url, /cliente-B\/rut-1.pdf$/)
  const sent = await request(f.app, '/api/documentos/rut', {
    method: 'POST',
    body: pdf,
  })
  assert.equal(sent.status, 200, JSON.stringify(sent.data))
  assert.equal(sent.data.actualizado, true)
  assert.equal(
    f.events.filter((e) => e[2] === 'DOCUMENTO_ACTUALIZADO').length,
    1,
  )
  const event = f.events.find((e) => e[2] === 'DOCUMENTO_ACTUALIZADO')[5]
  assert.equal(event.actorId, '11')
  assert.equal(event.sessionId, '21')
  assert.equal(event.detail.dispositivo_id, '31')
  assert.match(event.detail.contenido_sha256, /^[a-f0-9]{64}$/)
  assert.ok(!JSON.stringify(event).includes('fixture-archivo'))
  assert.equal(
    (await request(f.app, '/api/documentos/rut', { method: 'DELETE' })).status,
    404,
  )
  assert.ok(!f.calls.some((call) => call.options.method === 'DELETE'))
  f.revokeTerms()
  assert.equal((await request(f.app, '/api/documentos')).status, 403)
})
test('Documentos HTTP: bloquea archivo falso/excesivo, CSRF, consulta, campos extra y usos del parser fuera de esta ruta', async () => {
  const f = fixture()
  for (const [options, status] of [
    [{ body: pdf, key: 'reader' }, 403],
    [{ body: pdf, csrf: false }, 403],
    [{ body: Buffer.alloc(1025) }, 413],
    [{ body: Buffer.from('<html>ataque</html>') }, 415],
    [{ body: pdf, mime: 'text/html' }, 415],
    [{ body: Buffer.from('{}'), mime: 'application/json' }, 415],
  ]) {
    const result = await request(f.app, '/api/documentos/rut', {
      method: 'POST',
      ...options,
    })
    assert.equal(result.status, status, JSON.stringify(result.data))
  }
  assert.equal(
    (await request(f.app, '/api/productos', { method: 'POST', body: pdf }))
      .status,
    415,
  )
  assert.equal(
    (
      await request(f.app, '/api/documentos/lista_clinton', {
        method: 'POST',
        body: pdf,
      })
    ).status,
    400,
  )
  assert.equal(
    (await request(f.app, '/api/documentos/constructor/archivo')).status,
    400,
  )
  assert.equal(
    (
      await request(f.app, '/api/documentos/rut?cliente_id=2', {
        method: 'POST',
        body: pdf,
      })
    ).status,
    400,
  )
  assert.ok(!f.calls.some((call) => call.options.method === 'PUT'))
})

test('Carga inicial: ofrece tipos faltantes y registra el nuevo soporte en el cliente correcto', async () => {
  const f = fixture()
  const before = await request(f.app, '/api/documentos?buscar=RUT')
  assert.ok(
    before.data.tipos_disponibles.some((row) => row.tipo === 'camara_comercio'),
  )
  assert.equal(
    before.data.tipos_disponibles.some((row) => row.tipo === 'rut'),
    false,
  )
  const sent = await request(f.app, '/api/documentos/camara_comercio', {
    method: 'POST',
    body: pdf,
  })
  assert.equal(sent.status, 200, JSON.stringify(sent.data))
  const after = await request(f.app, '/api/documentos')
  assert.equal(after.data.total, 2)
  assert.equal(
    after.data.tipos_disponibles.some((row) => row.tipo === 'camara_comercio'),
    false,
  )
  const other = await request(f.app, '/api/documentos', { key: 'B' })
  assert.equal(other.data.total, 1)
  const event = f.events.find((entry) => entry[2] === 'DOCUMENTO_CARGADO')
  assert.equal(event[5].clientId, '1')
  assert.equal(event[5].detail.anterior_wms, null)
  assert.match(event[5].detail.actual_wms, /cliente-A\/camara_comercio-2\.pdf$/)
})
