const { test } = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')
const { IncomingMessage, ServerResponse } = require('node:http')
const { Duplex } = require('node:stream')
const { createRoutes } = require('../src/routes')
const { pagination } = require('../src/utils/businessValidation')

// Express completo con petición/respuesta en memoria: no abre puertos ni usa sesiones reales.
function request(app, url) {
  return new Promise((resolve, reject) => {
    const chunks = []
    const socket = new Duplex({ read() {}, write(chunk, encoding, callback) { chunks.push(Buffer.from(chunk)); callback() } })
    socket.remoteAddress = '127.0.0.1'
    const req = new IncomingMessage(socket)
    req.method = 'GET'
    req.url = url
    req.headers = { host: 'localhost' }
    req.rawHeaders = ['Host', 'localhost']
    req.httpVersion = '1.1'
    const res = new ServerResponse(req)
    res.assignSocket(socket)
    res.on('error', reject)
    res.on('finish', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      const body = raw.split('\r\n\r\n').slice(1).join('\r\n\r\n')
      resolve({ status: res.statusCode, body: JSON.parse(body) })
      socket.destroy()
    })
    app.handle(req, res)
  })
}

function fixture() {
  const app = express()
  app.set('query parser', 'simple')
  const auth = { tipo: 'NORMAL', cliente_id: '1', perfil: 'SOLICITANTE' }
  const modules = {
    auth: {}, clientes: {}, usuarios: {},
    sesiones: { authenticate: async () => auth },
    terminos: { requireAcceptance: async () => {} },
    productos: { list: async (identity, query) => ({ ...pagination(query), total: 0, data: [] }) },
    precargas: { list: async (identity, query) => ({ ...pagination(query), total: 0, data: [] }) },
    inventario: {
      list: async (identity, query) => ({ ...pagination(query), total: 0, data: [] }),
      products: async (identity, query) => ({ page: Number(query.page || 1), limit: Number(query.limit || 25), total: 0, data: [] }),
      lots: async (identity, code, query) => ({ codigo: code, unidad: query.unidad, total: 0, data: [] }),
    },
    movimientos: { list: async (identity, query) => ({ ...pagination(query), total: 0, data: [] }) },
    documentos: { list: async (identity, query) => ({ ...pagination(query), total: 0, data: [] }) },
  }
  app.use(createRoutes({ config: { cookie: { secure: false }, session: {}, documents: { maxFileBytes: 10485760 } }, db: { authenticate: async () => {} },
    security: {}, modules, limiters: { login: (req,res,next) => next(), password: (req,res,next) => next() } }))
  app.use((req,res) => res.status(404).json({ code: 'RUTA_NO_EXISTE' }))
  app.use((error,req,res,next) => res.status(error.status || 500).json({ code: error.code || 'ERROR_INTERNO' }))
  return app
}

test('Montaje completo: productos y precargas aceptan exclusivamente la paginación declarada', async () => {
  const app = fixture()
  for (const endpoint of ['productos','precargas','inventario','movimientos','documentos']) {
    assert.deepEqual(await request(app, `/api/${endpoint}?page=1&limit=25`), { status: 200, body: { page: 1, limit: 25, total: 0, data: [] } })
    assert.equal((await request(app, `/api/${endpoint}?cliente_id=2`)).status, 400)
  }
})

test('Salud valida únicamente sus rutas y no oculta una URL desconocida con un error de consulta', async () => {
  const app = fixture()
  assert.equal((await request(app, '/health')).status, 200)
  assert.equal((await request(app, '/health?page=1')).status, 400)
  assert.equal((await request(app, '/ready')).status, 200)
  assert.deepEqual(await request(app, '/api/ruta-inexistente?page=1&limit=25'), { status: 404, body: { code: 'RUTA_NO_EXISTE' } })
})

test('Inventario agrupado admite solo filtros declarados y exige unidad en el detalle', async () => {
  const app = fixture()
  assert.equal((await request(app, '/api/inventario/productos?page=1&limit=25&campo=lote&buscar=GEN_001&lotes=varios&ordenar=cantidad_desc&unidad=unidades')).status, 200)
  assert.deepEqual((await request(app, '/api/inventario/productos/YUT001/lotes?unidad=unidades&page=2&limit=25')).body, { codigo: 'YUT001', unidad: 'unidades', total: 0, data: [] })
  for (const url of ['/api/inventario/productos?cliente_id=2', '/api/inventario/productos?campo=otro', '/api/inventario/productos?ordenar=SQL', '/api/inventario/productos?lotes=0', '/api/inventario/productos/YUT001/lotes', '/api/inventario/productos/YUT001/lotes?unidad=kg&cliente_id=2', '/api/inventario/productos?unidad=kg&unidad=unidades'])
    assert.equal((await request(app, url)).status, 400, url)
})
