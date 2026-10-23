const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { randomBytes, randomUUID, createHash } = require('node:crypto')
const mysql = require('mysql2/promise')
const { createMovimientoRoutes } = require('../src/modules/movimientos/movimiento.routes')
const { createMovimientoController } = require('../src/modules/movimientos/movimiento.controller')
const {
  createInventarioRoutes,
} = require('../src/modules/inventario/inventario.routes')
const {
  createInventarioController,
} = require('../src/modules/inventario/inventario.controller')
const {
  createPrecargaLoteService,
} = require('../src/modules/precargas/precarga-lote.service')
const jwt = require('jsonwebtoken')
const { Router } = require('express')
const {
  createPrecargaInternoRoutes,
} = require('../src/modules/precargas/precarga-interno.routes')
const {
  createPrecargaInternoController,
} = require('../src/modules/precargas/precarga-interno.controller')
const {
  createProductoInternoRoutes,
} = require('../src/modules/productos/producto-interno.routes')
const {
  createProductoInternoController,
} = require('../src/modules/productos/producto-interno.controller')
const {
  createProductoInternoService,
} = require('../src/modules/productos/producto-interno.service')
const { createActorService } = require('../src/modules/actores/actor.service')
const {
  createAuditoriaService,
} = require('../src/modules/auditoria/auditoria.service')
const { productPayload } = require('../src/modules/productos/producto-wms')
const actual = require('../src/config/env')
const { createConnection } = require('../src/config/db')
const { initializeModels } = require('../src/models')
const { inspectDatabase } = require('../scripts/inspect-database')
const { createSecurity, randomSecret } = require('../src/utils/security')
const {
  createProductoBodegaService,
} = require('../src/modules/productos/producto-bodega.service')
const { createModules } = require('../src/modules')
const { createAuthMiddleware } = require('../src/middlewares/auth.middleware')
const {
  createProductoRoutes,
} = require('../src/modules/productos/producto.routes')
const {
  createProductoController,
} = require('../src/modules/productos/producto.controller')
const {
  createProductoService,
} = require('../src/modules/productos/producto.service')
const {
  createPrecargaRoutes,
} = require('../src/modules/precargas/precarga.routes')
const {
  createPrecargaController,
} = require('../src/modules/precargas/precarga.controller')
const {
  createPrecargaService,
} = require('../src/modules/precargas/precarga.service')

test('Productos y precargas con ORM/MariaDB aislada, sin iniciar servidores', async (t) => {
  const schema = 'externalclientes_ops_test_' + randomBytes(8).toString('hex')
  assert.match(schema, /^externalclientes_ops_test_[a-f0-9]{16}$/)
  assert.notEqual(schema, actual.db.database)
  const config = {
    ...actual,
    nodeEnv: 'test',
    operations: { ...actual.operations, changesEnabled:true, leadMinutes: 300, openingTime: '08:00', closingTime: '17:00' },
    wms: { ...actual.wms, jwtSecret: randomSecret() },
    db: { ...actual.db, database: schema, connectionLimit: 6 },
    password: { ...actual.password, N: 16384, p: 1, pepper: randomSecret() },
    session: {
      ...actual.session,
      hashSecret: randomSecret(),
      csrfSecret: randomSecret(),
    },
  }
  const { connectionLimit, ...directDb } = actual.db
  const bootstrap = await mysql.createConnection({
    ...directDb,
    database: undefined,
    multipleStatements: false,
  })
  let db
  t.after(async () => {
    if (db) await db.close()
    assert.match(schema, /^externalclientes_ops_test_[a-f0-9]{16}$/)
    assert.notEqual(schema, actual.db.database)
    await bootstrap.query(`DROP DATABASE IF EXISTS \`${schema}\``)
    await bootstrap.end()
  })
  const sql = [
    '001-inicial.sql',
    '002-terminos.sql',
    '003-producto-prefijo.sql',
    '004-catalogo-bodega-compartido.sql',
    '005-retiro-catalogo-cliente.sql',
    '006-operaciones.sql',
    '007-cambios-operacion.sql',
  ]
    .map((file) =>
      fs.readFileSync(path.join(config.root, 'database', file), 'utf8'),
    )
    .join('\n')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .replaceAll('`externalclientes`', '`' + schema + '`')
  for (const statement of sql
    .split(';')
    .map((value) => value.trim())
    .filter(Boolean))
    await bootstrap.query(statement)
  db = createConnection(config.db)
  const models = initializeModels(db,{operationChanges:true})
  assert.equal((await inspectDatabase(db)).tables, 34)
  const security = createSecurity(config)
  // WMS completamente simulado: no se envían peticiones al servidor real.
  const remote = new Map(),
    posts = []
  let remoteMode = 'normal'
  const inventoryCalls = []
  let stockUnavailable = false
  const remoteLots = new Map(),
    remoteLines = [],
    lotPosts = [],
    linePosts = []
  let lotMode = 'normal',
    missingLine = null
  let automaticAvailable = false,
    productsAutoAvailable = false
  let lateProduct = null,
    lateReadCount = 0
  const wms = {
    products: () => ({
      ...wms,
      listProducts: async () => {
        if (lateProduct && ++lateReadCount === 2)
          remote.set(lateProduct.Id_producto, lateProduct)
        return [...remote.values()].filter((row) => row.Tipo === 'Bodega')
      },
      validateProductPrefix: async () => {
        if (!productsAutoAvailable)
          throw Object.assign(
            new Error(
              'Confirmación remota suspendida para probar fichas anteriores',
            ),
            { status: 503 },
          )
      },
    }),
    preloads: () => {
      if (!automaticAvailable)
        throw Object.assign(new Error('Conexión simulada suspendida'), {
          status: 503,
        })
      return wms
    },
    inventory: async (id) => {
      inventoryCalls.push(id)
      if (stockUnavailable)
        throw Object.assign(new Error('WMS no disponible'), { status: 503 })
      return id === 'empresa-a'
        ? [
            {
              inventario_id: 1,
              lote_producto_id: 'LP-FIXTURE',
              lote_id: 'GEN_STOCK',
              producto_id: 'CAJ123',
              nombre: 'Nombre interno',
              referencia: 'INTERNA',
              unidad_medida: 'unidades',
              cantidad: '0.1',
              actualizado_at: '2026-10-19T14:00:00.000Z',
            },
            {
              inventario_id: 2,
              lote_producto_id: 'LP-FIXTURE',
              lote_id: 'GEN_STOCK',
              producto_id: 'CAJ123',
              nombre: 'Nombre interno',
              referencia: 'INTERNA',
              unidad_medida: 'unidades',
              cantidad: '0.2',
              actualizado_at: '2026-10-19T15:00:00.000Z',
            },
            {
              inventario_id: 3,
              lote_producto_id: 'LP-HISTORICO',
              lote_id: 'GEN_ANTERIOR',
              producto_id: 'UNI100',
              nombre: 'Producto histórico sin catálogo externo',
              referencia: 'INTERNA-ANTERIOR',
              unidad_medida: 'kilos',
              cantidad: '2.5',
              actualizado_at: null,
            },
          ]
        : []
    },
    listLots: async () => [...remoteLots.values()].map((row) => ({ ...row })),
    getLot: async (id) => remoteLots.get(id) ?? null,
    createLot: async (body) => {
      lotPosts.push({ ...body })
      if (lotMode === 'missing') throw new Error('Sin respuesta')
      if (remoteLots.has(body.Id_lote)) throw new Error('Lote duplicado')
      remoteLots.set(body.Id_lote, {
        ...body,
        ...(lotMode === 'collision' ? { Comentarios: 'Otro lote' } : {}),
      })
      if (lotMode === 'lost' || lotMode === 'collision')
        throw new Error('Respuesta perdida')
      return { ...body }
    },
    listLotProducts: async (id) =>
      remoteLines
        .filter((row) => row.id_lote === id)
        .map((row) => ({ ...row })),
    createLotProduct: async (body) => {
      linePosts.push({ ...body })
      if (body.id_producto === missingLine)
        throw new Error('Línea sin confirmar')
      const row = {
        ...body,
        id_lote_producto: 'LP-' + (remoteLines.length + 1),
        id_cliente: body.id_Cliente,
      }
      remoteLines.push(row)
      if (lotMode === 'lost') throw new Error('Respuesta de línea perdida')
      return row
    },
    validateClient: async (id) => ({
      wms_cliente_id: id,
      nombre: 'Empresa ' + id,
      activo: true,
    }),
    validateProductPrefix: async () => {},
    listProducts: async () => [...remote.values()].map((row) => ({ ...row })),
    getProduct: async (id) => (remote.has(id) ? { ...remote.get(id) } : null),
    createProduct: async (payload) => {
      posts.push({ ...payload })
      if (remoteMode === 'missing')
        throw new Error('Fallo de transporte simulado')
      if (remote.has(payload.Id_producto))
        throw new Error('Clave duplicada simulada')
      remote.set(payload.Id_producto, {
        ...payload,
        ...(remoteMode === 'collision'
          ? { Nombre: 'Otro producto concurrente' }
          : {}),
      })
      if (remoteMode === 'lost' || remoteMode === 'collision')
        throw new Error('Respuesta perdida simulada')
      return { ...payload }
    },
  }
  const modules = createModules({
    config,
    db,
    security,
    dummyHash: await security.hashPassword(randomSecret()),
    wms,
  })
  const context = {
    correlationId: randomUUID(),
    ip: '192.0.2.20',
    userAgent: 'Fixture sin dispositivo real',
  }
  const identity = {
    id: '17',
    name: 'Admin ficticio',
    personalId: 'persona-fixture',
  }
  const document = await modules.terminos.publish(
    {
      version: 'fixture-1',
      titulo: 'Prueba',
      contenido: 'Solo datos de prueba.',
    },
    identity,
    context,
  )
  async function account(username, client, perfil = 'SOLICITANTE') {
    const provision = await modules.usuarios.provision(
      {
        wms_cliente_id: client,
        username,
        correo: username + '@example.invalid',
        perfil,
      },
      identity,
      context,
    )
    const login = await modules.auth.login(
      { username, password: provision.password_temporal },
      null,
      context,
    )
    const provisional = await modules.sesiones.authenticate(
      login.session.token,
      login.deviceToken,
    )
    const password = randomSecret()
    const changed = await modules.auth.changePassword(
      provisional,
      {
        password_actual: provision.password_temporal,
        password_nueva: password,
      },
      context,
    )
    const auth = await modules.sesiones.authenticate(
      changed.session.token,
      login.deviceToken,
    )
    await modules.terminos.accept(
      auth,
      {
        version: document.version,
        contenido_sha256: document.contenido_sha256,
        acepto: true,
        autoriza_tratamiento_datos: true,
      },
      context,
    )
    return { auth, provisional, password, username }
  }
  const accountA = await account('cliente.a', 'empresa-a')
  const { auth: a, provisional } = accountA
  const { auth: b } = await account('cliente.b', 'empresa-b')
  const { auth: reader } = await account(
    'cliente.consulta',
    'empresa-a',
    'CONSULTA',
  )
  const middleware = createAuthMiddleware({
    security,
    sesiones: modules.sesiones,
    terminos: modules.terminos,
    cookies: {
      sessionToken: (req) => req.mockAuth?.token,
      deviceToken: (req) => req.mockAuth?.deviceToken,
    },
  })
  const productRouter = createProductoRoutes({
    controller: createProductoController(modules.productos),
    middleware,
  })
  const preloadRouter = createPrecargaRoutes({
    controller: createPrecargaController(modules.precargas),
    middleware,
  })
  const internalRouter = Router()
  internalRouter.use(middleware.internal)
  internalRouter.use(
    createProductoInternoRoutes(
      createProductoInternoController(modules.productosInternos),
    ),
  )
  function bearer(admin = true) {
    return (
      'Bearer ' +
      jwt.sign(
        {
          id_usuario: 17,
          username: 'admin.fixture',
          id_personal: identity.personalId,
          permisos: { esAdmin: admin },
          debe_cambiar_password: false,
        },
        config.wms.jwtSecret,
        { expiresIn: '1h' },
      )
    )
  }
  const internalIdentity = { ...identity, bearer: bearer() }
  // Se ejecuta Express Router directamente, sin sockets ni servidor HTTP.
  function request(router, method, auth, body, options = {}) {
    return new Promise((resolve, reject) => {
      const req = {
        method,
        url: options.path || '/',
        originalUrl: '/',
        baseUrl: '',
        query: options.query || {},
        body,
        headers: {
          ...(options.bearer ? { authorization: options.bearer } : {}),
          'x-csrf-token':
            options.csrf === false
              ? 'incorrecto'
              : auth
                ? security.csrf(auth.token)
                : '',
        },
        is: (type) => type === 'application/json',
        mockAuth: auth,
        context,
      }
      const res = {
        statusCode: 200,
        status(code) {
          this.statusCode = code
          return this
        },
        json(data) {
          resolve({ status: this.statusCode, data })
          return this
        },
      }
      router.handle(req, res, (error) =>
        error
          ? resolve({ status: error.status || 500, error })
          : resolve({ status: 404 }),
      )
    })
  }
  const productInput = {
    request_id: randomUUID(),
    prefijo: 'CAJ',
    confirmar_diferente: true,
    nombre: 'Producto prueba',
    referencia: 'Modelo',
    tipo: 'Bodega',
    unidad_medida: 'unidades',
    alto_cm: '1.25',
    ancho_cm: '2',
    largo_cm: '0',
  }
  let productA, productB, preloadBody, first

  await t.test(
    'Autenticación, primer ingreso, CSRF y perfil se verifican en servidor',
    async () => {
      assert.equal((await request(productRouter, 'GET', null)).status, 401)
      assert.equal(
        (await request(productRouter, 'POST', a, productInput, { csrf: false }))
          .status,
        403,
      )
      assert.equal(
        (await request(productRouter, 'POST', reader, productInput)).status,
        403,
      )
      await assert.rejects(
        modules.productos.create(provisional, productInput, context),
        { status: 403 },
      )
      assert.equal(await models.Producto.count(), 0)
      const catalog = await request(productRouter, 'GET', a, undefined, {
        path: '/catalogo',
      })
      assert.equal(catalog.status, 200)
      assert.equal(
        catalog.data.presentaciones.filter((item) => item.tipo === 'Bodega')
          .length,
        8,
      )
      assert.deepEqual(catalog.data.unidades, ['unidades', 'kilos', 'pallet'])
      assert.ok(
        catalog.data.presentaciones.some((item) => item.prefijo === 'YUT'),
      )
    },
  )
  await t.test(
    'Alta atómica por prefijo, reintento idempotente y listado aislado',
    async () => {
      const created = await request(productRouter, 'POST', a, productInput)
      assert.equal(created.status, 201)
      productA = created.data
      assert.equal(productA.estado, 'PENDIENTE')
      assert.equal(productA.prefijo, 'CAJ')
      assert.equal(productA.codigo_wms, null)
      assert.match(productA.codigo_cliente, /^BOD-/)
      assert.equal(
        (
          await request(productRouter, 'POST', a, {
            ...productInput,
            request_id: randomUUID(),
            tipo: 'RS',
          })
        ).status,
        400,
      )
      assert.equal(
        (await request(productRouter, 'POST', a, productInput)).status,
        201,
      )
      assert.equal(await models.Producto.count(), 1)
      assert.equal(
        (
          await request(productRouter, 'POST', a, {
            ...productInput,
            nombre: 'Otro contenido',
          })
        ).status,
        409,
      )
      assert.equal(
        (
          await request(productRouter, 'POST', a, {
            ...productInput,
            codigo_cliente: 'CAJ999',
          })
        ).status,
        400,
      )
      const other = await request(productRouter, 'POST', b, {
        ...productInput,
        nombre: 'Producto B',
      })
      assert.equal(other.status, 201)
      productB = other.data
      const result = await request(productRouter, 'GET', a, undefined, {
        query: { page: '1', limit: '25' },
      })
      assert.equal(result.status, 200)
      assert.equal(result.data.total, 1)
      assert.equal(
        result.data.data[0].cliente_producto_id,
        productA.cliente_producto_id,
      )
      assert.equal(JSON.stringify(result.data).includes('Producto B'), false)
      assert.equal((await request(productRouter, 'GET', reader)).data.total, 1)
      assert.equal(
        (
          await request(productRouter, 'POST', a, {
            ...productInput,
            cliente_id: b.cliente_id,
          })
        ).status,
        400,
      )
      assert.equal(await models.Producto.count(), 2)
      await models.ProductoEquivalencia.create({
        producto_version_id: productA.producto_version_id,
        wms_producto_id: 'CAJ123',
        validado_por_actor_id: a.actor_id,
        validado_at: new Date(),
      })
      const initialLink = await models.ClienteProducto.findByPk(
        productA.cliente_producto_id,
      )
      await initialLink.update({ estado: 'HABILITADO' })
      await models.Producto.update(
        { estado: 'VALIDADO' },
        { where: { id: initialLink.producto_id } },
      )
      await models.ProductoVersion.update(
        {
          estado: 'HOMOLOGADA',
          homologado_por_actor_id: a.actor_id,
          homologado_at: new Date(),
        },
        { where: { id: productA.producto_version_id } },
      )
      const mapped = await request(productRouter, 'GET', a)
      assert.equal(mapped.data.data[0].codigo_wms, 'CAJ123')
      assert.equal(
        (await request(productRouter, 'GET', b)).data.data[0].codigo_wms,
        null,
      )
    },
  )
  await t.test(
    'Cambios de permisos se vuelven a verificar antes de escribir y fallos revierten todo',
    async () => {
      await models.Usuario.update(
        { perfil: 'CONSULTA' },
        { where: { id: a.id } },
      )
      await assert.rejects(
        modules.productos.create(
          a,
          { ...productInput, request_id: randomUUID() },
          context,
        ),
        { status: 403 },
      )
      await models.Usuario.update(
        { perfil: 'SOLICITANTE' },
        { where: { id: a.id } },
      )
      const failing = createProductoService({
        db,
        bodega: createProductoBodegaService({
          db,
          wms,
          auditoria: {
            record: async () => {
              throw new Error('Fallo controlado de auditoría')
            },
          },
        }),
        sesiones: modules.sesiones,
        terminos: modules.terminos,
        auditoria: {
          record: async () => {
            throw new Error('Fallo controlado de auditoría')
          },
        },
      })
      await assert.rejects(
        failing.create(
          a,
          {
            ...productInput,
            request_id: randomUUID(),
            referencia: 'REVERSIBLE',
          },
          context,
        ),
        /controlado/,
      )
      assert.equal(await models.Producto.count(), 2)
      assert.equal(
        await models.ProductoVersion.count({
          where: { referencia: 'REVERSIBLE' },
        }),
        0,
      )
    },
  )
  await t.test(
    'La precarga rechaza productos ajenos, desconocidos y repetidos sin dejar cabeceras',
    async () => {
      preloadBody = {
        request_id: randomUUID(),
        referencia_lote: 'LOTE-FIXTURE',
        fecha_programada_at: new Date(Date.now() + 86400000).toISOString().slice(0, 10) + 'T08:00:00-05:00',
        referencia_contenedor: null,
        referencia_transporte: null,
        observacion: 'Recepción de prueba.',
        detalles: [
          {
            cliente_producto_id: productA.cliente_producto_id,
            producto_version_id: productA.producto_version_id,
            cantidad_declarada: '99999999.999999',
          },
        ],
      }
      for (const id of [productB.cliente_producto_id, '999999']) {
        assert.equal(
          (
            await request(preloadRouter, 'POST', a, {
              ...preloadBody,
              detalles: [
                {
                  cliente_producto_id: id,
                  producto_version_id: productA.producto_version_id,
                  cantidad_declarada: '1',
                },
              ],
            })
          ).status,
          422,
        )
      }
      assert.equal(
        (await request(preloadRouter, 'POST', reader, preloadBody)).status,
        403,
      )
      assert.equal(
        (await request(preloadRouter, 'POST', a, preloadBody, { csrf: false }))
          .status,
        403,
      )
      assert.equal(
        (
          await request(preloadRouter, 'POST', a, {
            ...preloadBody,
            detalles: [...preloadBody.detalles, ...preloadBody.detalles],
          })
        ).status,
        400,
      )
      assert.equal(await models.Solicitud.count(), 0)
      assert.equal(
        await models.ComandoIdempotente.count({
          where: { operacion: 'ENVIAR_PRECARGA' },
        }),
        0,
      )
    },
  )
  await t.test(
    'Envíos simultáneos con la misma clave generan una sola solicitud y revisión inmutable',
    async () => {
      const failing = createPrecargaService({
        config,
        db,
        sesiones: modules.sesiones,
        terminos: modules.terminos,
        auditoria: {
          record: async () => {
            throw new Error('Fallo controlado al auditar solicitud')
          },
        },
      })
      await assert.rejects(
        failing.create(a, preloadBody, context),
        /controlado/,
      )
      for (const name of [
        'Solicitud',
        'Precarga',
        'PrecargaLote',
        'PrecargaDetalle',
        'SolicitudRevision',
      ])
        assert.equal(await models[name].count(), 0)
      const login2 = await modules.auth.login(
        { username: accountA.username, password: accountA.password },
        null,
        context,
      )
      const secondDevice = await modules.sesiones.authenticate(
        login2.session.token,
        login2.deviceToken,
      )
      assert.notEqual(
        String(secondDevice.dispositivo_id),
        String(a.dispositivo_id),
      )
      const responses = await Promise.all([
        request(preloadRouter, 'POST', a, preloadBody),
        request(preloadRouter, 'POST', secondDevice, preloadBody),
      ])
      assert.equal(responses[0].status, 201)
      assert.equal(responses[1].status, 201)
      assert.deepEqual(responses[0].data, responses[1].data)
      first = responses[0].data
      assert.equal(first.estado, 'ENVIADA')
      assert.equal(await models.Solicitud.count(), 1)
      assert.equal(await models.PrecargaDetalle.count(), 1)
      const revision = await models.SolicitudRevision.findOne()
      const snapshot =
        typeof revision.contenido === 'string'
          ? JSON.parse(revision.contenido)
          : revision.contenido
      assert.equal(snapshot.detalles[0].cantidad_declarada, '99999999.999999')
      assert.ok(
        Buffer.from(revision.contenido_sha256).equals(
          createHash('sha256').update(JSON.stringify(snapshot)).digest(),
        ),
      )
      assert.equal(
        (await models.PrecargaDetalle.findOne()).cantidad_declarada,
        '99999999.999999',
      )
      assert.equal(
        (
          await request(preloadRouter, 'POST', a, {
            ...preloadBody,
            referencia_lote: 'CONTENIDO DISTINTO',
          })
        ).status,
        409,
      )
      assert.equal(await models.Solicitud.count(), 1)
    },
  )
  await t.test(
    'Listado por cliente, hora UTC, auditoría de usuario/dispositivo y fallo de conexión conserva la precarga',
    async () => {
      const own = await request(preloadRouter, 'GET', a)
      assert.equal(own.status, 200)
      assert.equal(own.data.total, 1)
      assert.equal(own.data.data[0].total_productos, 1)
      assert.equal(own.data.data[0].public_id, first.public_id)
      assert.equal(own.data.data[0].wms_lote_id, null)
      assert.match(own.data.data[0].creado_at, /Z$/)
      assert.equal((await request(preloadRouter, 'GET', b)).data.total, 0)
      assert.equal((await request(preloadRouter, 'GET', reader)).data.total, 1)
      assert.equal(
        (
          await request(preloadRouter, 'GET', a, undefined, {
            query: { cliente_id: b.cliente_id },
          })
        ).status,
        400,
      )
      const events = await models.EventoAuditoria.findAll({
        where: { codigo_evento: 'PRECARGA_ENVIADA' },
      })
      assert.equal(events.length, 1)
      const event = events[0]
      assert.equal(String(event.actor_id), String(a.actor_id))
      assert.ok(event.sesion_id)
      assert.ok(event.solicitud_id)
      const detail =
        typeof event.detalle_interno === 'string'
          ? JSON.parse(event.detalle_interno)
          : event.detalle_interno
      const auditedSession = await models.Sesion.findByPk(event.sesion_id)
      assert.equal(
        String(detail.dispositivo_id),
        String(auditedSession.dispositivo_id),
      )
      assert.equal(event.ip_origen, context.ip)
      assert.equal((await models.PrecargaLote.findOne()).wms_lote_id, null)
      // Solo simula el vínculo confirmado por Genika en esta base temporal.
      await models.PrecargaLote.update(
        { wms_lote_id: 'GENIKA-LOTE-FIXTURE' },
        { where: { cliente_id: a.cliente_id } },
      )
      const assigned = await request(preloadRouter, 'GET', a)
      assert.equal(assigned.data.data[0].wms_lote_id, 'GENIKA-LOTE-FIXTURE')
      assert.equal(
        assigned.data.data[0].referencia_lote,
        preloadBody.referencia_lote,
      )
      assert.equal((await request(preloadRouter, 'GET', b)).data.total, 0)
      const [outbox] = await db.query(
        'SELECT COUNT(*) AS total FROM envios_integracion',
      )
      assert.equal(Number(outbox[0].total), 0)
    },
  )
  await t.test(
    'Versiones nuevas no modifican solicitudes previas y productos deshabilitados no se pueden enviar',
    async () => {
      const link = await models.ClienteProducto.findByPk(
        productA.cliente_producto_id,
      )
      const version = await models.ProductoVersion.findOne({
        where: { producto_id: link.producto_id },
      })
      const { id, creado_at, ...fields } = version.get({ plain: true })
      await models.ProductoVersion.create({
        ...fields,
        numero_version: 2,
        nombre: 'Ficha versión dos',
      })
      assert.equal(
        (await modules.productos.list(a, {})).data[0].nombre,
        'Ficha versión dos',
      )
      const original = await models.SolicitudRevision.findOne()
      const snapshot =
        typeof original.contenido === 'string'
          ? JSON.parse(original.contenido)
          : original.contenido
      assert.equal(snapshot.detalles[0].nombre, 'Producto prueba')
      const stale = await request(preloadRouter, 'POST', a, {
        ...preloadBody,
        request_id: randomUUID(),
      })
      assert.equal(stale.status, 409)
      assert.equal(stale.error.code, 'PRODUCTO_ACTUALIZADO')
      assert.equal(
        (await request(preloadRouter, 'POST', a, preloadBody)).status,
        201,
      )
      await link.update({ estado: 'DESHABILITADO' })
      assert.equal(
        (
          await request(preloadRouter, 'POST', a, {
            ...preloadBody,
            request_id: randomUUID(),
          })
        ).status,
        422,
      )
      assert.equal(await models.Solicitud.count(), 1)
    },
  )
  async function fresh(prefix = 'YUT', suffix = randomUUID()) {
    return modules.productos.create(
      a,
      {
        ...productInput,
        request_id: randomUUID(),
        prefijo: prefix,
        nombre: 'Ficha ' + suffix,
        referencia: suffix,
      },
      context,
    )
  }
  await t.test(
    'Precargas visibles en ambos portales: detalle histórico, aislamiento y permisos internos',
    async () => {
      const internalPreloads = Router()
      internalPreloads.use(middleware.internal)
      internalPreloads.use(
        createPrecargaInternoRoutes(
          createPrecargaInternoController(modules.precargasInternas),
        ),
      )
      assert.equal((await request(internalPreloads, 'GET', null)).status, 401)
      assert.equal(
        (
          await request(internalPreloads, 'GET', null, undefined, {
            bearer: bearer(false),
          })
        ).status,
        403,
      )
      const list = await request(internalPreloads, 'GET', null, undefined, {
        bearer: bearer(),
      })
      assert.equal(list.status, 200)
      assert.equal(list.data.total, 1)
      assert.equal(list.data.data[0].cliente_nombre, 'Empresa empresa-a')
      const id = list.data.data[0].public_id
      const customer = await request(preloadRouter, 'GET', a, undefined, {
        path: '/' + id,
      })
      assert.equal(customer.status, 200)
      assert.equal(
        customer.data.detalles[0].nombre,
        'Producto prueba',
        'La consulta conserva la declaración aunque el catálogo haya cambiado',
      )
      assert.equal(
        customer.data.detalles[0].cantidad_declarada,
        preloadBody.detalles[0].cantidad_declarada,
      )
      assert.equal(customer.data.detalles[0].codigo_wms, 'CAJ123')
      assert.equal(customer.data.wms_lote_id, 'GENIKA-LOTE-FIXTURE')
      assert.equal(customer.data.cliente_id, undefined)
      assert.equal(
        (await request(preloadRouter, 'GET', b, undefined, { path: '/' + id }))
          .status,
        404,
      )
      assert.equal(
        (
          await request(preloadRouter, 'GET', reader, undefined, {
            path: '/' + id,
          })
        ).status,
        200,
      )
      assert.equal(
        (
          await request(preloadRouter, 'GET', a, undefined, {
            path: '/id-malformado',
          })
        ).status,
        400,
      )
      assert.equal(
        (
          await request(preloadRouter, 'GET', a, undefined, {
            path: '/' + id,
            query: { cliente_id: b.cliente_id },
          })
        ).status,
        400,
      )
      const detail = await request(internalPreloads, 'GET', null, undefined, {
        bearer: bearer(),
        path: '/' + id,
      })
      assert.equal(detail.status, 200)
      assert.deepEqual(detail.data.detalles, customer.data.detalles)
      assert.ok(detail.data.creado_por)
      for (const query of [
        { estado: 'RECHAZADA' },
        { cliente_id: b.cliente_id },
      ]) {
        assert.equal(
          (
            await request(internalPreloads, 'GET', null, undefined, {
              bearer: bearer(),
              query,
            })
          ).data.total,
          0,
        )
      }
      assert.equal(
        (
          await request(internalPreloads, 'GET', null, undefined, {
            bearer: bearer(),
            query: { campo: 'no permitido' },
          })
        ).status,
        400,
      )
    },
  )
  const approveInput = (row) => ({
    producto_version_id: row.producto_version_id,
    modo: 'CREAR',
  })
  const approve = (row, body = approveInput(row)) =>
    request(internalRouter, 'POST', null, body, {
      path: `/${row.cliente_producto_id}/aprobar`,
      bearer: internalIdentity.bearer,
    })
  await t.test(
    'Bandeja interna protegida por JWT firmado y permiso esAdmin; validación estricta',
    async () => {
      assert.equal((await request(internalRouter, 'GET', null)).status, 401)
      assert.equal(
        (
          await request(internalRouter, 'GET', null, undefined, {
            bearer: bearer(false),
          })
        ).status,
        403,
      )
      const list = await request(internalRouter, 'GET', null, undefined, {
        bearer: bearer(),
        query: { estado: 'PENDIENTE' },
      })
      assert.equal(list.status, 200)
      assert.ok(
        list.data.data.some(
          (row) => row.cliente_nombre === 'Empresa empresa-b' && row.creado_por,
        ),
      )
      const row = await fresh()
      const before = posts.length
      assert.equal(
        (await approve(row, { ...approveInput(row), cliente_id: 'otra' }))
          .status,
        400,
      )
      assert.equal(
        (
          await approve(row, {
            ...approveInput(row),
            producto_version_id: '999999',
          })
        ).status,
        409,
      )
      assert.equal(
        (
          await approve(row, {
            ...approveInput(row),
            wms_producto_id: 'YUT999',
          })
        ).status,
        400,
      )
      assert.equal(posts.length, before)
    },
  )
  await t.test(
    'Crear y aprobar genera un solo código con concurrencia; el cliente ve Habilitado y código WMS',
    async () => {
      const row = await fresh()
      remote.set('YUT005', productPayload(row, 'YUT005'))
      const before = posts.length
      const responses = await Promise.all([approve(row), approve(row)])
      assert.ok(
        responses.some((response) => response.status === 200),
        JSON.stringify(responses),
      )
      assert.ok(
        responses.every((response) => [200, 409].includes(response.status)),
      )
      const final = await approve(row)
      assert.equal(final.status, 200)
      assert.equal(final.data.codigo_wms, 'YUT006')
      assert.equal(final.data.estado, 'HABILITADO')
      assert.equal(posts.length, before + 1)
      const version = await models.ProductoVersion.findByPk(
        row.producto_version_id,
      )
      assert.equal(version.estado, 'HOMOLOGADA')
      assert.ok(version.homologado_por_actor_id && version.homologado_at)
      const link = await models.ClienteProducto.findByPk(
        row.cliente_producto_id,
      )
      assert.equal(
        (await models.Producto.findByPk(link.producto_id)).estado,
        'VALIDADO',
      )
      const customer = (
        await modules.productos.list(a, { limit: '100' })
      ).data.find(
        (item) => item.cliente_producto_id === row.cliente_producto_id,
      )
      assert.equal(customer.codigo_wms, 'YUT006')
      assert.equal(customer.estado, 'HABILITADO')
      assert.ok(
        await models.EventoAuditoria.findOne({
          where: {
            codigo_evento: 'PRODUCTO_CLIENTE_VALIDADO',
            entidad_id: row.cliente_producto_id,
          },
        }),
      )
    },
  )
  await t.test(
    'Vincular permite fichas distintas, conserva ambas referencias y no crea ni edita productos WMS',
    async () => {
      const row = await fresh('PAL')
      remote.set('PAL010', productPayload(row, 'PAL010'))
      const internalProduct = {
        ...productPayload(row, 'PAL011'),
        Nombre: 'Nombre interno',
        Referencia: 'REFERENCIA-INTERNA',
        Tipo: 'RS',
        Unidad_de_medida: 'kilos',
        Ancho: 999,
      }
      remote.set('PAL011', { ...internalProduct })
      const before = posts.length
      const input = {
        ...approveInput(row),
        modo: 'VINCULAR',
        wms_producto_id: 'PAL011',
      }
      assert.equal(
        (await approve(row, { ...input, wms_producto_id: 'NO-EXISTE' })).status,
        404,
      )
      const ok = await approve(row, input)
      assert.equal(ok.status, 200)
      assert.equal(ok.data.codigo_wms, 'PAL011')
      assert.equal(ok.data.referencia, row.referencia)
      assert.equal(ok.data.nombre, row.nombre)
      assert.equal(ok.data.unidad_medida, row.unidad_medida)
      assert.deepEqual(remote.get('PAL011'), internalProduct)
      const event = await models.EventoAuditoria.findOne({
        where: {
          codigo_evento: 'PRODUCTO_CLIENTE_VALIDADO',
          entidad_id: row.cliente_producto_id,
        },
      })
      const detail =
        typeof event.detalle_interno === 'string'
          ? JSON.parse(event.detalle_interno)
          : event.detalle_interno
      assert.equal(detail.modo, 'VINCULAR')
      assert.equal(detail.ficha_wms.Referencia, 'REFERENCIA-INTERNA')
      const same = await fresh('PAL', 'Otra referencia ' + randomUUID())
      assert.equal(
        (
          await approve(same, {
            ...approveInput(same),
            modo: 'VINCULAR',
            wms_producto_id: 'PAL011',
          })
        ).error.code,
        'CODIGO_WMS_YA_VINCULADO',
      )
      assert.equal(posts.length, before)
      const found = await request(internalRouter, 'GET', null, undefined, {
        bearer: bearer(),
        path: '/wms',
        query: { prefijo: 'PAL', buscar: row.referencia },
      })
      assert.equal(found.status, 200)
      assert.equal(found.data.data.length, 1)
    },
  )
  await t.test(
    'Vinculación concurrente completada antes del envío evita crear un producto sobrante',
    async () => {
      const row = await fresh('CAJ')
      remote.set('CAJ200', productPayload(row, 'CAJ200'))
      let release, arrived
      const gate = new Promise((resolve) => {
        release = resolve
      })
      const ready = new Promise((resolve) => {
        arrived = resolve
      })
      const service = createProductoInternoService({
        db,
        actores: createActorService({ models }),
        auditoria: createAuditoriaService({ models }),
        wms: {
          ...wms,
          listProducts: async () => {
            arrived()
            await gate
            return wms.listProducts()
          },
        },
      })
      const before = posts.length
      const creating = service.approve(
        row.cliente_producto_id,
        approveInput(row),
        internalIdentity,
        context,
      )
      await ready
      try {
        assert.equal(
          (
            await approve(row, {
              ...approveInput(row),
              modo: 'VINCULAR',
              wms_producto_id: 'CAJ200',
            })
          ).status,
          200,
        )
      } finally {
        release()
      }
      assert.equal((await creating).codigo_wms, 'CAJ200')
      assert.equal(posts.length, before)
    },
  )
  await t.test(
    'Respuesta perdida se reconcilia; respuesta incierta nunca repite el POST',
    async () => {
      const lost = await fresh()
      const before = posts.length
      remoteMode = 'lost'
      assert.equal((await approve(lost)).status, 200)
      assert.equal(posts.length, before + 1)
      const uncertain = await fresh()
      remoteMode = 'missing'
      assert.equal(
        (await approve(uncertain)).error.code,
        'WMS_CONFIRMACION_PENDIENTE',
      )
      assert.equal(
        (await approve(uncertain)).error.code,
        'WMS_CONFIRMACION_PENDIENTE',
      )
      assert.equal(posts.length, before + 2)
      const list = await modules.productosInternos.list({
        estado: 'PENDIENTE',
        limit: 100,
      })
      assert.equal(
        list.data.find(
          (item) => item.cliente_producto_id === uncertain.cliente_producto_id,
        ).integracion.estado,
        'ENVIADO',
      )
      const pending = posts.at(-1)
      remote.set(pending.Id_producto, {
        ...pending,
        Referencia: 'OTRO-RESULTADO',
      })
      assert.equal(
        (
          await approve(uncertain, {
            ...approveInput(uncertain),
            modo: 'VINCULAR',
            wms_producto_id: pending.Id_producto,
          })
        ).error.code,
        'FICHA_WMS_DIFERENTE',
        'Vincular no evita conciliar un intento de creación ya enviado',
      )
      remote.set(pending.Id_producto, { ...pending })
      remoteMode = 'normal'
      assert.equal((await approve(uncertain)).status, 200)
      assert.equal(posts.length, before + 2)
    },
  )
  await t.test(
    'Colisión de consecutivo no sobrescribe la ficha; siguiente intento recalcula el código',
    async () => {
      const row = await fresh()
      const before = posts.length
      remoteMode = 'collision'
      assert.equal((await approve(row)).error.code, 'CODIGO_WMS_OCUPADO')
      const occupiedCode = posts.at(-1).Id_producto
      remoteMode = 'normal'
      const result = await approve(row)
      assert.equal(result.status, 200)
      assert.notEqual(result.data.codigo_wms, occupiedCode)
      assert.equal(remote.get(occupiedCode).Nombre, 'Otro producto concurrente')
      assert.equal(posts.length, before + 2)
    },
  )
  await t.test(
    'Fallo local después de crear WMS revierte aprobación y permite recuperar sin duplicados',
    async () => {
      const row = await fresh()
      const auditoria = createAuditoriaService({ models })
      const faulty = createProductoInternoService({
        db,
        wms,
        actores: createActorService({ models }),
        auditoria: {
          record: async (...args) => {
            if (args[2] === 'PRODUCTO_CLIENTE_VALIDADO')
              throw new Error('Fallo de auditoría simulado')
            return auditoria.record(...args)
          },
        },
      })
      const before = posts.length
      await assert.rejects(
        faulty.approve(
          row.cliente_producto_id,
          approveInput(row),
          internalIdentity,
          context,
        ),
        /auditoría simulado/,
      )
      assert.equal(
        (await models.ClienteProducto.findByPk(row.cliente_producto_id)).estado,
        'PENDIENTE',
      )
      assert.equal(
        await models.ProductoEquivalencia.count({
          where: { producto_version_id: row.producto_version_id },
        }),
        0,
      )
      assert.equal((await approve(row)).status, 200)
      assert.equal(posts.length, before + 1)
      assert.equal(
        await models.Solicitud.count(),
        1,
        'No crea lotes ni inventario al validar productos',
      )
    },
  )
  const lotRouter = Router()
  lotRouter.use(middleware.internal)
  lotRouter.use(
    createPrecargaInternoRoutes(
      createPrecargaInternoController(
        modules.precargasInternas,
        modules.lotesPrecargas,
      ),
    ),
  )
  const verifyLot = (row, revision = 1, token = bearer()) =>
    request(
      lotRouter,
      'POST',
      null,
      { revision },
      { path: `/${row.public_id}/crear-lote`, bearer: token },
    )
  async function cargo(count = 1, validate = true) {
    const products = []
    for (let i = 0; i < count; i++) {
      const product = await fresh()
      if (validate) assert.equal((await approve(product)).status, 200)
      products.push(product)
    }
    const wasAvailable = automaticAvailable
    automaticAvailable = false
    let created
    try {
      created = await modules.precargas.create(
        a,
        {
          ...preloadBody,
          request_id: randomUUID(),
          referencia_lote: 'Carga ' + randomUUID(),
          detalles: products.map((product) => ({
            cliente_producto_id: product.cliente_producto_id,
            producto_version_id: product.producto_version_id,
            cantidad_declarada: '12.000001',
          })),
        },
        context,
      )
    } finally {
      automaticAvailable = wasAvailable
    }
    return { ...created, products }
  }
  automaticAvailable = true
  await t.test(
    'Recuperar lote requiere admin, revisión vigente y productos validados; crea lote sin una decisión de aprobación',
    async () => {
      await assert.rejects(cargo(1, false), {
        code: 'PRODUCTO_PENDIENTE_VALIDACION',
      })
      const pending = await cargo()
      await models.ClienteProducto.update(
        { estado: 'PENDIENTE' },
        { where: { id: pending.products[0].cliente_producto_id } },
      )
      const before = lotPosts.length
      assert.equal((await verifyLot(pending, 1, '')).status, 401)
      assert.equal((await verifyLot(pending, 1, bearer(false))).status, 403)
      assert.equal(
        (await verifyLot(pending, 2)).error.code,
        'PRECARGA_ACTUALIZADA',
      )
      assert.equal(
        (await verifyLot(pending)).error.code,
        'PRODUCTO_PENDIENTE_VALIDACION',
      )
      assert.equal(lotPosts.length, before)
      const row = await cargo()
      remoteLots.set('GEN_012', {
        Id_lote: 'GEN_012',
        Comentarios: 'Anterior',
      })
      const lineBefore = linePosts.length
      const results = await Promise.all([verifyLot(row), verifyLot(row)])
      assert.ok(
        results.some((result) => result.status === 200),
        JSON.stringify(results),
      )
      assert.ok(results.every((result) => [200, 409].includes(result.status)))
      const result = await verifyLot(row)
      assert.equal(result.status, 200)
      assert.equal(result.data.wms_lote_id, 'GEN_013')
      assert.equal(result.data.estado, 'ENVIADA')
      assert.equal(lotPosts.length, before + 1)
      assert.equal(linePosts.length, lineBefore + 1)
      assert.equal(linePosts.at(-1).id_Cliente, 'empresa-a')
      assert.equal(linePosts.at(-1).Cantidad, '12.000001')
      const customer = await modules.precargas.detail(a, row.public_id)
      assert.equal(customer.estado, 'ENVIADA')
      assert.equal(customer.wms_lote_id, 'GEN_013')
      assert.equal(customer.aprobacion, null)
      assert.equal(await models.DecisionSolicitud.count(), 0)
    },
  )
  await t.test(
    'Creación recupera respuestas perdidas y no sobrescribe un lote concurrente',
    async () => {
      const row = await cargo()
      lotMode = 'lost'
      assert.equal((await verifyLot(row)).status, 200)
      const collision = await cargo()
      lotMode = 'collision'
      assert.equal((await verifyLot(collision)).error.code, 'LOTE_WMS_OCUPADO')
      const old = lotPosts.at(-1).Id_lote
      lotMode = 'normal'
      const result = await verifyLot(collision)
      assert.equal(result.status, 200)
      assert.notEqual(result.data.wms_lote_id, old)
      assert.equal(remoteLots.get(old).Comentarios, 'Otro lote')
    },
  )
  await t.test(
    'Importación parcial conserva avances y verifica sin repetir las líneas ya enviadas',
    async () => {
      const row = await cargo(2)
      const eq = await models.ProductoEquivalencia.findOne({
        where: { producto_version_id: row.products[1].producto_version_id },
      })
      missingLine = eq.wms_producto_id
      const before = linePosts.length,
        lotsBefore = lotPosts.length
      assert.equal(
        (await verifyLot(row)).error.code,
        'WMS_CONFIRMACION_PENDIENTE',
      )
      const progress = await modules.precargasInternas.detail(row.public_id)
      assert.equal(progress.estado, 'ENVIADA')
      assert.equal(progress.integracion.lineas_confirmadas, 1)
      assert.equal(progress.wms_lote_id, null)
      assert.equal(
        (await verifyLot(row)).error.code,
        'WMS_CONFIRMACION_PENDIENTE',
      )
      assert.equal(linePosts.length, before + 2)
      assert.equal(lotPosts.length, lotsBefore + 1)
      const payload = linePosts.at(-1)
      remoteLines.push({
        ...payload,
        id_cliente: payload.id_Cliente,
        id_lote_producto: 'LP-RECUPERADA',
      })
      missingLine = null
      assert.equal((await verifyLot(row)).status, 200)
      assert.equal(linePosts.length, before + 2)
    },
  )
  await t.test(
    'Fallo local al finalizar revierte vínculo; verificar recupera sin crear otro lote',
    async () => {
      const row = await cargo()
      const audit = createAuditoriaService({ models })
      const faulty = createPrecargaLoteService({
        db,
        wms,
        read: modules.precargasInternas,
        actores: createActorService({ models }),
        auditoria: {
          record: async (...args) => {
            if (args[2] === 'PRECARGA_LOTE_CREADO')
              throw new Error('Fallo final simulado')
            return audit.record(...args)
          },
        },
      })
      const before = lotPosts.length,
        beforeLines = linePosts.length
      await assert.rejects(
        faulty.createForInternal(
          row.public_id,
          { revision: 1 },
          internalIdentity,
          context,
        ),
        /Fallo final simulado/,
      )
      const pending = await modules.precargasInternas.detail(row.public_id)
      assert.equal(pending.estado, 'ENVIADA')
      assert.equal(pending.aprobacion, null)
      assert.equal(pending.wms_lote_id, null)
      assert.equal((await verifyLot(row)).status, 200)
      assert.equal(lotPosts.length, before + 1)
      assert.equal(linePosts.length, beforeLines + 1)
    },
  )
  await t.test(
    'Cliente crea lote automático con productos validados, sin aprobación y con reintentos aislados por cliente',
    async () => {
      const product = await fresh()
      assert.equal((await approve(product)).status, 200)
      const input = {
        ...preloadBody,
        request_id: randomUUID(),
        referencia_lote: 'Automática',
        detalles: [
          {
            cliente_producto_id: product.cliente_producto_id,
            producto_version_id: product.producto_version_id,
            cantidad_declarada: '3.25',
          },
        ],
      }
      lotMode = 'normal'
      const before = lotPosts.length
      const created = await request(preloadRouter, 'POST', a, input)
      assert.equal(created.status, 201)
      assert.ok(created.data.wms_lote_id)
      assert.equal(created.data.estado, 'ENVIADA')
      assert.equal(created.data.aprobacion, null)
      assert.equal(created.data.creacion_error, undefined)
      assert.equal(
        (await request(preloadRouter, 'POST', a, input)).data.wms_lote_id,
        created.data.wms_lote_id,
      )
      assert.equal(lotPosts.length, before + 1)
      assert.equal(await models.DecisionSolicitud.count(), 0)
      const path = `/${created.data.public_id}/crear-lote`
      assert.equal(
        (await request(preloadRouter, 'POST', b, { revision: 1 }, { path }))
          .status,
        404,
      )
      assert.equal(
        (
          await request(
            preloadRouter,
            'POST',
            reader,
            { revision: 1 },
            { path },
          )
        ).status,
        403,
      )
      assert.equal(
        (
          await request(
            preloadRouter,
            'POST',
            a,
            { revision: 1 },
            { path, csrf: false },
          )
        ).status,
        403,
      )
      assert.equal(
        (
          await request(
            preloadRouter,
            'POST',
            a,
            { revision: 1, cliente_id: b.cliente_id },
            { path },
          )
        ).status,
        400,
      )
      const event = await models.EventoAuditoria.findOne({
        where: {
          codigo_evento: 'PRECARGA_LOTE_CREADO',
          solicitud_id: (
            await models.Solicitud.findOne({
              where: { public_id: created.data.public_id },
            })
          ).id,
        },
      })
      assert.equal(String(event.actor_id), String(a.actor_id))
      assert.equal(String(event.sesion_id), String(a.sesion_id))
      assert.equal(
        (
          await request(
            lotRouter,
            'POST',
            null,
            { revision: 1 },
            { path: `/${created.data.public_id}/aprobar`, bearer: bearer() },
          )
        ).status,
        404,
      )
      // Una respuesta perdida del lote se verifica sin otro POST, incluso al reabrir desde el portal.
      lotMode = 'missing'
      const lostInput = {
        ...input,
        request_id: randomUUID(),
        referencia_lote: 'Guardada pendiente',
      }
      const pending = await request(preloadRouter, 'POST', a, lostInput)
      assert.equal(pending.status, 201)
      assert.equal(pending.data.wms_lote_id, null)
      assert.ok(pending.data.creacion_error)
      const post = lotPosts.at(-1)
      remoteLots.set(post.Id_lote, post)
      lotMode = 'normal'
      const count = lotPosts.length
      const recovered = await request(
        preloadRouter,
        'POST',
        a,
        { revision: 1 },
        { path: `/${pending.data.public_id}/crear-lote` },
      )
      assert.equal(recovered.data.wms_lote_id, post.Id_lote)
      assert.equal(lotPosts.length, count)
    },
  )
  await t.test('Precarga automática suma referencias de una misma ficha WMS y recupera el registro pendiente sin aprobación ni duplicados', async () => {
    const products = [await fresh(), await fresh(), await fresh()]
    const approved = []
    for (const product of products) {
      const result = await approve(product)
      assert.equal(result.status, 200)
      approved.push(result.data)
    }
    // Representa dos fichas externas ya vinculadas al mismo producto interno.
    await models.ProductoEquivalencia.update(
      { wms_producto_id: approved[0].codigo_wms },
      { where: { producto_version_id: products[1].producto_version_id } },
    )
    const input = {
      ...preloadBody,
      request_id: randomUUID(),
      referencia_lote: 'Referencias externas agrupadas',
      detalles: products.map((product, index) => ({
        cliente_producto_id: product.cliente_producto_id,
        producto_version_id: product.producto_version_id,
        cantidad_declarada: ['0.1', '0.2', '4'][index],
      })),
    }
    lotMode = 'normal'
    const before = lotPosts.length, beforeLines = linePosts.length
    let pending
    automaticAvailable = false
    try {
      pending = await request(preloadRouter, 'POST', a, input)
    } finally {
      automaticAvailable = true
    }
    assert.equal(pending.status, 201)
    assert.equal(pending.data.wms_lote_id, null)
    assert.equal(lotPosts.length, before)
    // Repetir el mismo envío recupera el guardado; nunca crea otra solicitud.
    const recovered = await request(preloadRouter, 'POST', a, input)
    assert.equal(recovered.status, 201)
    assert.equal(recovered.data.public_id, pending.data.public_id)
    assert.ok(recovered.data.wms_lote_id)
    assert.equal(recovered.data.creacion_error, undefined)
    assert.equal(recovered.data.aprobacion, null)
    assert.equal(recovered.data.detalles.length, 3)
    assert.deepEqual(recovered.data.detalles.map(row => row.cantidad_declarada), ['0.1', '0.2', '4'])
    assert.equal(lotPosts.length, before + 1)
    assert.deepEqual(linePosts.slice(beforeLines).map(row => ({ code: row.id_producto, quantity: row.Cantidad, client: row.id_Cliente })), [
      { code: approved[0].codigo_wms, quantity: '0.3', client: 'empresa-a' },
      { code: approved[2].codigo_wms, quantity: '4.000000', client: 'empresa-a' },
    ])
    const repeated = await request(preloadRouter, 'POST', a, input)
    assert.equal(repeated.data.wms_lote_id, recovered.data.wms_lote_id)
    assert.equal(lotPosts.length, before + 1)
    assert.equal(linePosts.length, beforeLines + 2)
    const freshInput = { ...input, request_id: randomUUID(), referencia_lote: 'Creación directa agrupada' }
    const direct = await request(preloadRouter, 'POST', a, freshInput)
    assert.equal(direct.status, 201)
    assert.ok(direct.data.wms_lote_id)
    assert.notEqual(direct.data.wms_lote_id, recovered.data.wms_lote_id)
    assert.equal(direct.data.creacion_error, undefined)
    assert.equal(await models.DecisionSolicitud.count(), 0)
    assert.equal(lotPosts.length, before + 2)
    assert.equal(linePosts.length, beforeLines + 4)
  })
  await t.test('Ingreso crea lote y agenda atómicos, valida 5 horas y horario, comparte agenda sin crear alistamiento y respeta titularidad', async () => {
    const product = await fresh()
    const approved = await approve(product)
    const product2 = await fresh()
    const approved2 = await approve(product2)
    assert.equal(approved.status, 200)
    const day = new Date(Date.now() + 86400000).toISOString().slice(0,10)
    const input = {
      ...preloadBody, request_id: randomUUID(), referencia_lote: 'Agenda ingreso fixture',
      fecha_programada_at: day + 'T08:00:00-05:00',
      detalles: [{ cliente_producto_id: product.cliente_producto_id, producto_version_id: product.producto_version_id, cantidad_declarada: '3.5' }, { cliente_producto_id: product2.cliente_producto_id, producto_version_id: product2.producto_version_id, cantidad_declarada: '10' }],
    }
    const previousMovements = wms.movements
    const previousInventory = wms.inventory
    let received = '0', movementCalls = 0
    const before = await models.Solicitud.count()
    for (const hour of ['07:59', '17:01']) {
      const invalid = await request(preloadRouter, 'POST', a, { ...input, fecha_programada_at: day + 'T' + hour + ':00-05:00' })
      assert.equal(invalid.error.code, 'HORARIO_NO_PERMITIDO')
    }
    const tooSoon = new Date(Date.now() + 299 * 60000 - 5 * 3600000).toISOString().slice(0,16) + ':00-05:00'
    assert.equal((await request(preloadRouter,'POST',a,{...input,fecha_programada_at:tooSoon})).error.code,'ANTICIPACION_INSUFICIENTE')
    assert.equal((await request(preloadRouter,'POST',a,{...input,fecha_programada_at:day+'T08:00:00Z'})).status,400)
    assert.equal(await models.Solicitud.count(),before)
    lotMode = 'normal'
    const created = await request(preloadRouter,'POST',a,input)
    assert.equal(created.status,201)
    assert.ok(created.data.wms_lote_id)
    assert.equal(created.data.fecha_programada_at,new Date(input.fecha_programada_at).toISOString())
    const order = await models.Solicitud.findOne({where:{public_id:created.data.public_id}})
    assert.equal(await models.Operacion.count({where:{solicitud_id:order.id}}),0)
    const schedule = await models.Programacion.findOne({where:{solicitud_id:order.id}})
    assert.equal(schedule.anticipo_minutos_aplicado,300)
    assert.equal(+new Date(schedule.plazo_validado_at),+new Date(order.creado_at))
    assert.equal((await request(preloadRouter,'POST',a,input)).data.wms_lote_id,created.data.wms_lote_id)
    assert.equal(await models.Programacion.count({where:{solicitud_id:order.id}}),1)
    const {createOperacionRoutes}=require('../src/modules/operaciones/operacion.routes')
    const {createOperacionController}=require('../src/modules/operaciones/operacion.controller')
    const router=createOperacionRoutes({controller:createOperacionController(modules.operaciones,modules.cambiosOperaciones,modules.operacionesInternas),middleware})
    wms.movements = async () => { throw new Error('La recepción no debe consultar historial') }
    wms.inventory = async id => {
      assert.equal(id,'empresa-a')
      movementCalls++
      const rows = received === '0' ? [] : [{inventario_id:'INGRESO-TEST',producto_id:approved.data.codigo_wms,lote_id:created.data.wms_lote_id,cantidad:received === 'CERRADO' ? '0' : received,unidad_medida:'unidades'}]
      if (received === '3.5' || received === 'CERRADO') rows.push({inventario_id:'INGRESO-TEST-2',producto_id:approved2.data.codigo_wms,lote_id:created.data.wms_lote_id,cantidad:received === 'CERRADO' ? '0' : '0.1',unidad_medida:'unidades'})
      return rows
    }
    try {
      const path = '/' + order.public_id
      const detail = await request(router,'GET',reader,undefined,{path})
      assert.equal(detail.status,200)
      assert.equal(detail.data.tipo_operacion,'INGRESO')
      assert.equal(detail.data.estado,'INGRESO_AGENDADO')
      assert.equal(detail.data.permite_cambios,false)
      const preloadState = async () => {
        movementCalls = 0
        const response = await request(preloadRouter,'GET',reader)
        assert.equal(response.status,200)
        assert.equal(movementCalls,1,'Una consulta de inventario por cliente para toda la página de precargas')
        const row = response.data.data.find(row=>row.public_id===order.public_id)
        assert.ok(row)
        assert.equal(Object.hasOwn(row,'detalles'),false)
        assert.ok(!JSON.stringify(row).includes('id_ubicacion'))
        return row.recepcion.estado
      }
      assert.equal(await preloadState(),'PENDIENTE')
      assert.equal((await request(router,'GET',b,undefined,{path})).status,404)
      assert.equal((await request(router,'POST',a,{}, {path:path+'/confirmar'})).status,404)
      received = '1'
      assert.equal((await request(router,'GET',a,undefined,{path})).data.estado,'INGRESO_PARCIAL')
      assert.equal(await preloadState(),'PARCIAL')
      received = '3.5'
      assert.equal((await request(router,'GET',a,undefined,{path})).data.estado,'INGRESO_CONFIRMADO')
      assert.equal(await preloadState(),'RECIBIDA')
      movementCalls = 0
      const listing = await request(router,'GET',a)
      assert.ok(listing.data.data.some(row=>row.public_id===order.public_id && row.tipo_operacion==='INGRESO'))
      assert.equal(movementCalls,1,'La agenda consulta inventario por cliente, no por cada precarga')
      const internal = await modules.operacionesInternas.list({desde:day,hasta:day,buscar:'Agenda ingreso fixture',limit:'25'})
      assert.equal(internal.total,1)
      assert.equal(internal.data[0].wms_lote_id,created.data.wms_lote_id)
      assert.equal(internal.data[0].estado,'INGRESO_CONFIRMADO')
      for(const field of ['id_ubicacion','id_bodega','payload_sha256','wms_cliente_id']) assert.ok(!JSON.stringify(listing.data).includes(field))
      assert.equal((await inspectDatabase(db)).tables,34)
      received = 'CERRADO'
      assert.equal(await preloadState(),'CERRADA')
      const closedDetail = await request(router,'GET',a,undefined,{path})
      assert.equal(closedDetail.data.recepcion.estado,'CERRADA')
      assert.equal(closedDetail.data.recepcion.productos_en_inventario,0)
      wms.inventory=async()=>{throw new Error('WMS fuera de línea')}
      const unavailable = await request(preloadRouter,'GET',a)
      assert.equal(unavailable.status,200)
      assert.equal(unavailable.data.data.find(row=>row.public_id===order.public_id).recepcion.estado,'NO_DISPONIBLE')
    } finally { wms.movements = previousMovements; wms.inventory = previousInventory }
  })
  await t.test('Detalle de recepción consume WMS desde externalclientes y aísla cliente en ambos portales',async()=>{
    const {Op}=require('sequelize')
    const lot=await models.PrecargaLote.findOne({where:{cliente_id:a.cliente_id,wms_lote_id:{[Op.ne]:null}}})
    const order=await models.Solicitud.findByPk(lot.solicitud_id)
    const initial=await modules.precargas.detail(a,order.public_id)
    const previous=wms.inventory,calls=[]
    wms.inventory=async id=>{calls.push(id);return initial.detalles.map((line,index)=>({inventario_id:String(index+1),lote_id:initial.wms_lote_id,producto_id:line.codigo_wms,
      cantidad:line.cantidad_declarada,unidad_medida:line.unidad_medida}))}
    try {
      const customer=await request(preloadRouter,'GET',a,undefined,{path:'/'+order.public_id})
      assert.equal(customer.status,200)
      assert.equal(customer.data.recepcion.estado,'RECIBIDA')
      assert.equal(customer.data.detalles[0].cantidad_recibida,initial.detalles[0].cantidad_declarada)
      assert.equal(calls.at(-1),'empresa-a')
      assert.equal((await modules.precargasInternas.detail(order.public_id)).recepcion.estado,'RECIBIDA')
      const {createRoutes}=require('../src/routes')
      const router=createRoutes({config,db,security,modules,limiters:{login:(req,res,next)=>next(),password:(req,res,next)=>next()}})
      const operator='Bearer '+jwt.sign({id_usuario:77,username:'bodega.fixture',id_personal:'P77',permisos:{gestionBodega:true}},config.wms.jwtSecret,{expiresIn:'1h'})
      const path='/api/interno/lotes/'+encodeURIComponent(initial.wms_lote_id)+'/declaracion'
      const warehouse=await request(router,'GET',null,undefined,{path,bearer:operator})
      assert.equal(warehouse.status,200,warehouse.error?.stack)
      assert.equal(warehouse.data.public_id,order.public_id)
      assert.equal(warehouse.data.recepcion.estado,'RECIBIDA')
      assert.equal((await request(router,'GET',null,undefined,{path,bearer:bearer(false)})).status,403)
      assert.equal((await request(router,'GET',null,undefined,{path})).status,401)
      assert.equal((await request(router,'POST',null,{revision:1},{path:'/api/interno/precargas/'+order.public_id+'/crear-lote',bearer:operator})).status,403)
      assert.equal((await request(router,'GET',null,undefined,{path:'/api/interno/lotes/LOTE-NORMAL-SIN-PORTAL/declaracion',bearer:operator})).data,null)
      assert.equal((await request(router,'GET',null,undefined,{path,bearer:operator,query:{cliente_id:b.cliente_id}})).status,400)
      const count=calls.length
      assert.equal((await request(preloadRouter,'GET',b,undefined,{path:'/'+order.public_id})).status,404)
      assert.equal(calls.length,count)
      assert.equal(JSON.stringify(customer.data).includes('id_ubicacion'),false)
      wms.inventory=async()=>{throw new Error('Caída simulada')}
      assert.equal((await modules.precargas.detail(a,order.public_id)).recepcion.estado,'NO_DISPONIBLE')
    } finally {wms.inventory=previous}
  })
  await t.test(
    'Inventario real por cliente: suma posiciones sin redondear, mantiene lotes y no expone ubicaciones',
    async () => {
      const router = createInventarioRoutes({
        controller: createInventarioController(modules.inventario),
        middleware,
      })
      assert.equal((await request(router, 'GET', null)).status, 401)
      assert.equal(
        (
          await request(router, 'GET', a, undefined, {
            query: { cliente_id: b.cliente_id },
          })
        ).status,
        400,
      )
      const view = await request(router, 'GET', a)
      assert.equal(view.status, 200)
      assert.equal(view.data.total, 2)
      const stock = view.data.data.find((row) => row.codigo_wms === 'CAJ123')
      assert.equal(stock.cantidad_actual, '0.3')
      assert.equal(stock.nombre, 'Producto prueba')
      assert.equal(stock.referencia_cliente, 'Modelo')
      assert.equal(stock.referencia_wms, 'INTERNA')
      assert.equal(stock.ultimo_movimiento_at, '2026-10-19T15:00:00.000Z')
      assert.equal(stock.wms_lote_id, 'GEN_STOCK')
      assert.ok(
        view.data.data.some((row) => row.codigo_wms === 'UNI100'),
        'El stock propio previo al portal también es visible',
      )
      assert.equal((await request(router, 'GET', reader)).data.total, 2)
      assert.equal((await request(router, 'GET', b)).data.total, 0)
      assert.equal(inventoryCalls.at(-1), 'empresa-b')
      assert.ok(
        !/ubicacion|bodega_id|lote_producto_id|inventario_id|service.key|password/i.test(
          JSON.stringify(view.data),
        ),
      )
      stockUnavailable = true
      assert.equal(
        (await request(router, 'GET', a)).status,
        503,
        'Una falla de WMS no se informa como saldo cero',
      )
      stockUnavailable = false
    },
  )
  await t.test(
    'Catálogo Bodega: lectura global saneada, creación directa, reutilización exacta y aviso de similitudes',
    async () => {
      productsAutoAvailable = true
      remoteMode = 'normal'
      const source = {
        Id_producto: 'UNI555',
        Nombre: 'Caja catálogo reutilizable',
        Referencia: 'REF-PUBLICA',
        Tipo: 'Bodega',
        Unidad_de_medida: 'unidades',
        Alto: 1,
        Ancho: 2,
        Largo: 3,
        Cliente: { id: 'privado' },
        id_Cliente: 'empresa-ajena',
        Ubicacion: 'no-exponer',
      }
      remote.set(source.Id_producto, source)
      remote.set('RS555', { ...source, Id_producto: 'RS555', Tipo: 'RS' })
      const directory = await request(productRouter, 'GET', reader, undefined, {
        path: '/bodega',
        query: { buscar: 'reutilizable' },
      })
      assert.equal(directory.status, 200)
      assert.equal(directory.data.data.length, 1)
      assert.equal(directory.data.data[0].codigo_wms, source.Id_producto)
      assert.ok(
        !/ubicacion|empresa-ajena|privado|id_Cliente/i.test(
          JSON.stringify(directory.data),
        ),
      )
      assert.equal(
        (
          await request(productRouter, 'GET', a, undefined, {
            path: '/bodega',
            query: { cliente_id: b.cliente_id },
          })
        ).status,
        400,
      )
      assert.equal(
        (
          await request(
            productRouter,
            'POST',
            reader,
            { codigo_wms: 'UNI555' },
            { path: '/vincular' },
          )
        ).status,
        403,
      )
      assert.equal(
        (
          await request(
            productRouter,
            'POST',
            a,
            { codigo_wms: 'UNI555' },
            { path: '/vincular', csrf: false },
          )
        ).status,
        403,
      )
      const added = await request(
        productRouter,
        'POST',
        a,
        { codigo_wms: 'UNI555' },
        { path: '/vincular' },
      )
      assert.equal(added.status, 200)
      assert.equal(added.data.estado, 'HABILITADO')
      const other = await request(
        productRouter,
        'POST',
        b,
        { codigo_wms: 'UNI555' },
        { path: '/vincular' },
      )
      assert.equal(
        other.data.producto_version_id,
        added.data.producto_version_id,
      )
      assert.notEqual(
        other.data.cliente_producto_id,
        added.data.cliente_producto_id,
      )
      const before = posts.length
      const input = {
        ...productInput,
        request_id: randomUUID(),
        prefijo: 'UNI',
        nombre: 'Caja catálogo reutilizable',
        referencia: 'REF-PUBLICA',
        alto_cm: '1',
        ancho_cm: '2',
        largo_cm: '3',
      }
      const reused = await request(productRouter, 'POST', a, input)
      assert.equal(reused.data.codigo_wms, 'UNI555')
      assert.equal(
        posts.length,
        before,
        'Reutilizar no vuelve a crear ni editar en WMS',
      )
      const similarInput = {
        ...input,
        request_id: randomUUID(),
        nombre: 'Caja catalogo reutilizables',
        referencia: 'REF-PUBLICA-OTRA',
        confirmar_diferente: false,
      }
      const found = await request(productRouter, 'GET', a, undefined, {
        path: '/similares',
        query: {
          nombre: similarInput.nombre,
          referencia: similarInput.referencia,
        },
      })
      assert.ok(found.data.data.some((row) => row.codigo_wms === 'UNI555'))
      const denied = await request(productRouter, 'POST', a, similarInput)
      assert.equal(denied.error.code, 'PRODUCTOS_SIMILARES')
      const created = await request(productRouter, 'POST', a, {
        ...similarInput,
        confirmar_diferente: true,
      })
      assert.equal(created.status, 201)
      assert.equal(created.data.estado, 'HABILITADO')
      assert.ok(created.data.codigo_wms)
      assert.equal(posts.length, before + 1)
      assert.equal(
        (
          await request(productRouter, 'POST', a, {
            ...similarInput,
            confirmar_diferente: true,
          })
        ).data.codigo_wms,
        created.data.codigo_wms,
      )
      assert.equal(posts.length, before + 1)
      const event = await models.EventoAuditoria.findOne({
        where: {
          codigo_evento: 'PRODUCTO_CLIENTE_VALIDADO',
          entidad_id: created.data.cliente_producto_id,
        },
      })
      assert.ok(event)
      assert.equal(String(event.actor_id), String(a.actor_id))
      assert.equal(String(event.sesion_id), String(a.sesion_id))
      await models.ClienteProducto.update(
        { estado: 'DESHABILITADO' },
        { where: { id: added.data.cliente_producto_id } },
      )
      const blocked = await request(
        productRouter,
        'POST',
        a,
        { codigo_wms: 'UNI555' },
        { path: '/vincular' },
      )
      assert.equal(blocked.error.code, 'PRODUCTO_DESHABILITADO')
      await models.ClienteProducto.update(
        { estado: 'HABILITADO' },
        { where: { id: added.data.cliente_producto_id } },
      )
      lateProduct = {
        ...source,
        Id_producto: 'UNI777',
        Nombre: 'Ficha que aparece durante el guardado',
        Referencia: randomUUID(),
      }
      lateReadCount = 0
      const countBeforeLate = posts.length
      const late = await modules.productos.create(
        a,
        {
          ...productInput,
          request_id: randomUUID(),
          prefijo: 'UNI',
          nombre: lateProduct.Nombre,
          referencia: lateProduct.Referencia,
          alto_cm: '1',
          ancho_cm: '2',
          largo_cm: '3',
        },
        context,
      )
      assert.equal(late.codigo_wms, 'UNI777')
      assert.equal(late.estado, 'HABILITADO')
      assert.equal(
        posts.length,
        countBeforeLate,
        'Se repite la comparación antes de crear en WMS',
      )
      lateProduct = null
      const concurrentInput = {
        ...productInput,
        nombre: 'Maestra compartida ' + randomUUID(),
        referencia: randomUUID(),
        request_id: randomUUID(),
      }
      const postedBefore = posts.length
      const parallel = await Promise.all([
        modules.productos.create(a, concurrentInput, context),
        modules.productos.create(
          b,
          { ...concurrentInput, request_id: randomUUID() },
          context,
        ),
      ])
      const confirmed = await Promise.all(
        parallel.map((row, index) =>
          modules.productos.confirm(
            index ? b : a,
            row.cliente_producto_id,
            context,
          ),
        ),
      )
      assert.ok(
        confirmed.every((row) => row.estado === 'HABILITADO'),
        JSON.stringify(confirmed),
      )
      assert.equal(confirmed[0].codigo_wms, confirmed[1].codigo_wms)
      assert.equal(
        confirmed[0].producto_version_id,
        confirmed[1].producto_version_id,
      )
      assert.equal(
        posts.length,
        postedBefore + 1,
        'Dos empresas crean una misma maestra y un solo producto remoto',
      )
      assert.equal(
        (
          await request(
            productRouter,
            'POST',
            b,
            {},
            { path: `/${created.data.cliente_producto_id}/confirmar` },
          )
        ).status,
        404,
      )
      // La creación del catálogo no consulta ni altera existencias; el siguiente paso es el lote.
      const lot = await request(preloadRouter, 'POST', a, {
        ...preloadBody,
        request_id: randomUUID(),
        detalles: [
          {
            cliente_producto_id: created.data.cliente_producto_id,
            producto_version_id: created.data.producto_version_id,
            cantidad_declarada: '2',
          },
        ],
      })
      assert.ok(lot.data.wms_lote_id)
      assert.equal(lot.data.aprobacion, null)
    },
  )
  await t.test(
    'Buscar inventario compara código, nombre, referencias y lote antes de paginar',
    async () => {
      const previous = wms.inventory
      const rows = Array.from({ length: 30 }, (_, index) => ({
        inventario_id: 1000 + index,
        lote_producto_id: `LP-BUSCAR-${index}`,
        lote_id: `GEN_BUSCAR_${index}`,
        producto_id: `UNI-BUSCAR-${index}`,
        nombre:
          index === 29
            ? 'Artículo único última página'
            : `Producto de búsqueda ${index}`,
        referencia: `REF-BUSCAR-${index}`,
        unidad_medida: 'unidades',
        cantidad: '1',
        actualizado_at: null,
      }))
      wms.inventory = async (id) => (id === 'empresa-a' ? rows : [])
      try {
        const router = createInventarioRoutes({
          controller: createInventarioController(modules.inventario),
          middleware,
        })
        assert.equal((await request(router, 'GET', a)).data.data.length, 25)
        for (const buscar of [
          'ultima pagina',
          'UNI-BUSCAR-29',
          'REF-BUSCAR-29',
          'GEN_BUSCAR_29',
        ]) {
          const found = await request(router, 'GET', a, undefined, {
            query: { buscar },
          })
          assert.equal(found.status, 200)
          assert.equal(found.data.total, 1)
          assert.equal(found.data.data[0].codigo_wms, 'UNI-BUSCAR-29')
        }
        assert.equal(
          (
            await request(router, 'GET', b, undefined, {
              query: { buscar: 'ultima pagina' },
            })
          ).data.total,
          0,
        )
        assert.equal(
          (
            await request(router, 'GET', a, undefined, {
              query: { buscar: 'No existe' },
            })
          ).data.total,
          0,
        )
        assert.equal(
          (
            await request(router, 'GET', a, undefined, {
              query: { buscar: 'x'.repeat(251) },
            })
          ).status,
          400,
        )
      } finally {
        wms.inventory = previous
      }
    },
  )
  await t.test(
    'Quitar del catálogo valida existencias de la empresa y conserva maestra, equivalencias, WMS e historial',
    async () => {
      const pathFor = (row) => `/${row.cliente_producto_id}`
      const row = await fresh()
      assert.equal(row.estado, 'HABILITADO')
      const bLink = await modules.productos.useExisting(
        b,
        row.codigo_wms,
        context,
      )
      const historical = await modules.precargas.create(
        a,
        {
          ...preloadBody,
          request_id: randomUUID(),
          detalles: [
            {
              cliente_producto_id: row.cliente_producto_id,
              producto_version_id: row.producto_version_id,
              cantidad_declarada: '1',
            },
          ],
        },
        context,
      )
      assert.ok(historical.wms_lote_id)
      assert.equal(
        (
          await request(
            productRouter,
            'DELETE',
            reader,
            {},
            { path: pathFor(row) },
          )
        ).status,
        403,
      )
      assert.equal(
        (
          await request(
            productRouter,
            'DELETE',
            a,
            {},
            { path: pathFor(row), csrf: false },
          )
        ).status,
        403,
      )
      assert.equal(
        (await request(productRouter, 'DELETE', b, {}, { path: pathFor(row) }))
          .status,
        404,
      )
      assert.equal(
        (
          await request(
            productRouter,
            'DELETE',
            a,
            { cliente_id: b.cliente_id },
            { path: pathFor(row) },
          )
        ).status,
        400,
      )
      const blocked = await request(
        productRouter,
        'DELETE',
        a,
        {},
        { path: pathFor(productA) },
      )
      assert.equal(blocked.status, 409)
      assert.equal(blocked.error.code, 'PRODUCTO_CON_EXISTENCIAS')
      assert.equal(
        (await models.ClienteProducto.findByPk(productA.cliente_producto_id))
          .retirado_at,
        null,
      )
      stockUnavailable = true
      assert.equal(
        (await request(productRouter, 'DELETE', a, {}, { path: pathFor(row) }))
          .status,
        503,
      )
      stockUnavailable = false
      assert.equal(
        (await models.ClienteProducto.findByPk(row.cliente_producto_id))
          .retirado_at,
        null,
      )
      const failing = createProductoService({
        db,
        wms,
        sesiones: modules.sesiones,
        terminos: modules.terminos,
        bodega: createProductoBodegaService({ db, wms, auditoria: {} }),
        auditoria: {
          record: async () => {
            throw new Error('Auditoría falló al retirar')
          },
        },
      })
      await assert.rejects(
        failing.remove(a, row.cliente_producto_id, context),
        /Auditoría falló/,
      )
      assert.equal(
        (await models.ClienteProducto.findByPk(row.cliente_producto_id))
          .retirado_at,
        null,
      )
      const count = await models.Producto.count(),
        mappings = await models.ProductoEquivalencia.count(),
        postsBefore = posts.length,
        lotsBefore = lotPosts.length,
        linesBefore = linePosts.length
      const previous = wms.inventory
      // Stock de otra empresa no impide retirar de la propia; saldo cero propio sí permite retirarlo.
      wms.inventory = async (id) => [
        {
          inventario_id: 9999,
          producto_id: row.codigo_wms,
          cantidad: id === 'empresa-b' ? '99' : '0',
        },
      ]
      try {
        const removed = await Promise.all([
          request(productRouter, 'DELETE', a, {}, { path: pathFor(row) }),
          request(productRouter, 'DELETE', a, {}, { path: pathFor(row) }),
        ])
        assert.ok(removed.every((result) => result.status === 200))
        assert.equal(
          (
            await request(
              productRouter,
              'DELETE',
              b,
              {},
              { path: pathFor(bLink) },
            )
          ).error.code,
          'PRODUCTO_CON_EXISTENCIAS',
        )
      } finally {
        wms.inventory = previous
      }
      const link = await models.ClienteProducto.findByPk(
        row.cliente_producto_id,
      )
      assert.ok(link.retirado_at)
      assert.equal(link.estado, 'HABILITADO')
      assert.equal(
        (await models.ClienteProducto.findByPk(bLink.cliente_producto_id))
          .retirado_at,
        null,
      )
      assert.equal(await models.Producto.count(), count)
      assert.equal(await models.ProductoEquivalencia.count(), mappings)
      assert.ok(remote.has(row.codigo_wms))
      assert.equal(posts.length, postsBefore)
      assert.equal(lotPosts.length, lotsBefore)
      assert.equal(linePosts.length, linesBefore)
      const listed = await modules.productos.list(a, {
        page: '1',
        limit: '100',
      })
      assert.ok(
        !listed.data.some(
          (item) => item.cliente_producto_id === row.cliente_producto_id,
        ),
      )
      assert.equal(
        (await modules.precargas.detail(a, historical.public_id)).wms_lote_id,
        historical.wms_lote_id,
      )
      await assert.rejects(
        modules.precargas.create(
          a,
          {
            ...preloadBody,
            request_id: randomUUID(),
            detalles: [
              {
                cliente_producto_id: row.cliente_producto_id,
                producto_version_id: row.producto_version_id,
                cantidad_declarada: '1',
              },
            ],
          },
          context,
        ),
        { code: 'PRODUCTO_NO_DISPONIBLE' },
      )
      const events = await models.EventoAuditoria.findAll({
        where: {
          codigo_evento: 'PRODUCTO_RETIRADO_CATALOGO',
          entidad_id: row.cliente_producto_id,
        },
      })
      assert.equal(events.length, 1)
      assert.equal(String(events[0].actor_id), String(a.actor_id))
      assert.equal(String(events[0].sesion_id), String(a.sesion_id))
      const restored = await modules.productos.useExisting(
        a,
        row.codigo_wms,
        context,
      )
      assert.equal(restored.cliente_producto_id, row.cliente_producto_id)
      assert.equal(
        (await models.ClienteProducto.findByPk(row.cliente_producto_id))
          .retirado_at,
        null,
      )
      assert.equal(posts.length, postsBefore)
    },
  )
  await t.test('Operaciones: agenda, aislamiento, anticipo, auditoría y reintento sin duplicar WMS', async () => {
    const remoteOperations = new Map(), operationCalls=[]
    let lost=true,stage='PENDIENTE',remoteState='ABIERTO'
    wms.operations = () => ({
      validateClient:wms.validateClient,
      create:async body => {
        operationCalls.push(structuredClone(body))
        let saved=remoteOperations.get(body.request_id)
        if (!saved) {
          saved={request_id:body.request_id,id_cliente:body.id_cliente,id_alistamiento:20+remoteOperations.size,estado:'ABIERTO',etapa:'PENDIENTE'}
          remoteOperations.set(body.request_id,saved)
        }
        if(lost){lost=false;throw new Error('Respuesta perdida después de crear')}
        return {...saved}
      },
      obtain:async id => remoteOperations.has(id) ? ({...remoteOperations.get(id),etapa:stage,estado:remoteState}) : null,
      statuses:async ids => ids.filter(id=>remoteOperations.has(id)).map(id=>({...remoteOperations.get(id),etapa:stage,estado:remoteState})),
    })
    const {createOperacionRoutes}=require('../src/modules/operaciones/operacion.routes')
    const {createOperacionController}=require('../src/modules/operaciones/operacion.controller')
    const router=createOperacionRoutes({controller:createOperacionController(modules.operaciones,modules.cambiosOperaciones),middleware})
    const scheduled=new Date(Date.now()+86400000-5*3600000).toISOString().slice(0,10)+'T15:00:00-05:00'
    const input={request_id:randomUUID(),nombre:'Recogida de prueba',modalidad:'RECOGIDA',fecha_programada_at:scheduled,
      destinatario:null,direccion_entrega:null,observacion:null,detalles:[{codigo_wms:'UNI100',wms_lote_id:'GEN_ANTERIOR',cantidad:'0.5'}]}
    const expected=await models.Solicitud.count()
    assert.equal((await request(router,'POST',reader,input)).status,403)
    assert.equal((await request(router,'POST',a,input,{csrf:false})).status,403)
    assert.equal((await request(router,'POST',provisional,input)).status,401)
    assert.equal((await request(router,'POST',a,{...input,cliente_id:b.cliente_id})).status,400)
    const tooSoon={...input,fecha_programada_at:new Date(Date.now()-5*3600000).toISOString().slice(0,16)+':00-05:00'}
    assert.equal((await request(router,'POST',a,tooSoon)).error.code,'ANTICIPACION_INSUFICIENTE')
    const fourHours59={...input,fecha_programada_at:new Date(Date.now()+299*60000-5*3600000).toISOString().slice(0,16)+':00-05:00'}
    assert.equal((await request(router,'POST',a,fourHours59)).error.code,'ANTICIPACION_INSUFICIENTE')
    for(const hour of ['07:59','17:01','23:00']) {
      const outside={...input,fecha_programada_at:scheduled.slice(0,10)+'T'+hour+':00-05:00'}
      assert.equal((await request(router,'POST',a,outside)).error.code,'HORARIO_NO_PERMITIDO')
    }
    assert.equal(operationCalls.length,0)
    assert.equal((await request(router,'POST',a,{...input,detalles:[{...input.detalles[0],cantidad:'9999'}]})).status,409)
    assert.equal((await request(router,'POST',b,input)).status,422)
    assert.equal(await models.Solicitud.count(),expected)
    const response=await request(router,'POST',a,input)
    assert.equal(response.status,201)
    assert.equal(response.data.estado,'PENDIENTE_WMS')
    assert.equal(remoteOperations.size,1)
    const uuid=response.data.public_id
    assert.ok(response.data.integracion_error)
    assert.equal((await request(router,'GET',b,undefined,{path:'/'+uuid})).status,404)
    assert.equal((await request(router,'POST',b,{}, {path:'/'+uuid+'/confirmar'})).status,404)
    const [retry1,retry2]=await Promise.all([request(router,'POST',a,input),request(router,'POST',a,input)])
    assert.equal(retry1.data.wms_alistamiento_id,20)
    assert.equal(retry2.data.wms_alistamiento_id,20)
    assert.equal(remoteOperations.size,1)
    assert.equal(await models.Solicitud.count(),expected+1)
    assert.deepEqual(operationCalls[0],operationCalls[1])
    assert.equal(operationCalls[0].id_cliente,'empresa-a')
    assert.equal(Object.hasOwn(operationCalls[0],'id_personal'),false)
    assert.equal(Object.hasOwn(operationCalls[0].items[0],'id_ubicacion_origen'),false)
    assert.equal((await request(router,'POST',a,{...input,nombre:'Alterado'})).status,409)
    stage='EN_PREPARACION'
    assert.equal((await request(router,'GET',a,undefined,{path:'/'+uuid})).data.estado,'EN_PREPARACION')
    stage='LISTO'
    assert.equal((await request(router,'GET',a,undefined,{path:'/'+uuid})).data.estado,'LISTO')
    remoteState='DESPACHADO'
    assert.equal((await request(router,'GET',a,undefined,{path:'/'+uuid})).data.estado,'SALIDA_CONFIRMADA')
    const listing=await request(router,'GET',reader)
    assert.equal(listing.data.total,1)
    assert.equal(listing.data.anticipacion_minutos,config.operations.leadMinutes)
    const serialized=JSON.stringify(listing.data)
    for(const field of ['id_bodega','id_ubicacion','payload_sha256','wms_cliente_id']) assert.ok(!serialized.includes(field))
    const audit=await models.EventoAuditoria.findOne({where:{codigo_evento:'OPERACION_AGENDADA',actor_id:a.actor_id}})
    assert.equal(String(audit.sesion_id),a.sesion_id)
    const raw=typeof audit.detalle_interno==='string'?JSON.parse(audit.detalle_interno):audit.detalle_interno
    assert.equal(raw.dispositivo_id,a.dispositivo_id)
    const orderForSchedule = await models.Solicitud.findOne({where:{public_id:uuid}})
    assert.equal(await models.Programacion.count({where:{solicitud_id:orderForSchedule.id}}),1)
    remoteState='CANCELADO'
    assert.equal((await request(router,'GET',a,undefined,{path:'/'+uuid})).data.estado,'CANCELADA')
    wms.operations=()=>{throw new Error('WMS fuera de línea')}
    const offline=await request(router,'GET',a,undefined,{path:'/'+uuid})
    assert.equal(offline.data.estado_no_disponible,true)
    assert.equal(offline.data.estado,null)
  })
  await t.test('Cambios de operación: permisos, revisión, idempotencia y conciliación sin repetir cancelaciones', async () => {
    const remote=new Map(),cancelCalls=[]
    let uncertainCancel=false
    wms.operations=()=>({validateClient:wms.validateClient,
      create:async body=>{const result={request_id:body.request_id,id_cliente:body.id_cliente,id_alistamiento:900+remote.size,estado:'ABIERTO',etapa:'PENDIENTE'};remote.set(body.request_id,result);return result},
      obtain:async id=>remote.get(id)||null,
      statuses:async ids=>ids.map(id=>remote.get(id)).filter(Boolean),
      cancel:async(id,bearer,motivo)=>{cancelCalls.push({id,bearer,motivo});if(uncertainCancel)throw new Error('respuesta incierta');[...remote.values()].find(row=>row.id_alistamiento===id).estado='CANCELADO';throw new Error('se perdió la respuesta después de cancelar')},
    })
    const {createOperacionRoutes}=require('../src/modules/operaciones/operacion.routes')
    const {createOperacionController}=require('../src/modules/operaciones/operacion.controller')
    const router=createOperacionRoutes({controller:createOperacionController(modules.operaciones,modules.cambiosOperaciones),middleware})
    const {createRoutes}=require('../src/routes')
    const internal=createRoutes({config,db,security,modules,limiters:{login:(req,res,next)=>next(),password:(req,res,next)=>next()}})
    const token='Bearer '+jwt.sign({id_usuario:77,username:'operador.cambios',id_personal:'P77',permisos:{gestionBodega:true}},config.wms.jwtSecret,{expiresIn:'1h'})
    const pickup=new Date(Date.now()+2*86400000-5*3600000).toISOString().slice(0,10)+'T15:00:00-05:00'
    const input={request_id:randomUUID(),nombre:'Operación para cambios',modalidad:'RECOGIDA',fecha_programada_at:pickup,destinatario:null,direccion_entrega:null,observacion:null,detalles:[{codigo_wms:'UNI100',wms_lote_id:'GEN_ANTERIOR',cantidad:'0.1'}]}
    const saved=await modules.operaciones.create(a,input,context),path='/'+saved.public_id+'/cambios'
    const correction={request_id:randomUUID(),tipo:'CORREGIR',motivo:'Cambió la transportadora',datos:{nombre:'Nombre corregido',destinatario:'Transportadora nueva',observacion:'Presentar identificación'}}
    assert.equal((await request(router,'POST',reader,correction,{path})).status,403)
    assert.equal((await request(router,'POST',b,correction,{path})).status,404)
    assert.equal((await request(router,'POST',a,correction,{path,csrf:false})).status,403)
    assert.equal((await request(router,'POST',a,{...correction,datos:{...correction.datos,detalles:[]}},{path})).status,400)
    const sent=await request(router,'POST',a,correction,{path});assert.equal(sent.status,201,sent.error?.stack)
    assert.equal(sent.data.nombre,input.nombre);assert.equal(sent.data.cambio_pendiente,true)
    assert.equal((await request(router,'POST',a,correction,{path})).data.total_cambios,1)
    assert.equal((await request(router,'POST',a,{...correction,motivo:'Alterado'},{path})).status,409)
    assert.equal((await request(router,'POST',a,{...correction,request_id:randomUUID()},{path})).error.code,'CAMBIO_PENDIENTE')
    const changeId=sent.data.cambios[0].public_id
    const decisionPath='/api/interno/operaciones/'+saved.public_id+'/cambios/'+changeId+'/decision'
    const apply={decision:'APLICAR',motivo:'Confirmado por bodega'}
    assert.equal((await request(internal,'POST',null,apply,{path:decisionPath,bearer:bearer(false)})).status,403)
    const applied=await request(internal,'POST',null,apply,{path:decisionPath,bearer:token});assert.equal(applied.status,200,applied.error?.stack)
    assert.equal(applied.data.nombre,'Nombre corregido');assert.equal(applied.data.cambio_pendiente,false)
    assert.equal((await request(internal,'POST',null,apply,{path:decisionPath,bearer:token})).data.cambios[0].estado,'APLICADO')
    const newDay=new Date(Date.parse(pickup)+86400000-5*3600000).toISOString().slice(0,10)
    const schedule={request_id:randomUUID(),tipo:'REPROGRAMAR',motivo:'Cambio de vehículo',datos:{fecha_programada_at:newDay+'T16:00:00-05:00'}}
    assert.equal((await request(router,'POST',a,{...schedule,datos:{fecha_programada_at:pickup.slice(0,10)+'T18:00:00-05:00'}},{path})).error.code,'HORARIO_NO_PERMITIDO')
    const rescheduled=await request(router,'POST',a,schedule,{path});assert.equal(rescheduled.status,201)
    const sc=rescheduled.data.cambios[0]
    const order=await models.Solicitud.findOne({where:{public_id:saved.public_id}})
    const before=await models.SolicitudRevision.findOne({where:{solicitud_id:order.id}})
    const original=JSON.stringify(before.contenido)
    const originalLead=config.operations.leadMinutes
    config.operations.leadMinutes=10080
    try {await modules.cambiosOperaciones.decide(saved.public_id,sc.public_id,apply,internalIdentity,context)} finally {config.operations.leadMinutes=originalLead}
    const updated=await modules.operaciones.detail(a,saved.public_id)
    assert.equal(updated.fecha_programada_at,schedule.datos.fecha_programada_at)
    assert.equal(updated.fecha_original_wms,new Date(pickup).toISOString())
    const agenda=await request(internal,'GET',null,undefined,{path:'/api/interno/operaciones',bearer:token,query:{desde:newDay,hasta:newDay,page:'1',limit:'25'}})
    assert.equal(agenda.status,200,agenda.error?.stack)
    assert.ok(agenda.data.data.some(row=>row.public_id===saved.public_id))
    const publicAgenda={path:'/api/interno/programacion-bodega',bearer:bearer(false),query:{desde:newDay,hasta:newDay,page:'1',limit:'25'}}
    assert.equal((await request(internal,'GET',null,undefined,publicAgenda)).status,200)
    assert.equal((await request(internal,'GET',null,undefined,{...publicAgenda,bearer:undefined})).status,401)
    assert.equal((await request(internal,'POST',null,apply,{...publicAgenda,path:'/api/interno/operaciones/'+saved.public_id+'/cambios/'+sc.public_id+'/decision',query:{}})).status,403)
    assert.equal((await request(internal,'GET',null,undefined,{...publicAgenda,path:'/api/interno/operaciones/'+saved.public_id,query:{}})).status,403)
    const previousDay=await request(internal,'GET',null,undefined,{path:'/api/interno/operaciones',bearer:token,query:{desde:pickup.slice(0,10),hasta:pickup.slice(0,10)}})
    assert.equal(previousDay.status,200,previousDay.error?.stack)
    assert.equal(previousDay.data.data.some(row=>row.public_id===saved.public_id),false)
    for(const query of [{desde:newDay},{desde:'2026-02-30',hasta:newDay},{desde:'2026-01-01',hasta:'2026-12-31'},{desde:newDay,hasta:'2026-01-01'},{desde:{'$ne':null},hasta:newDay}])
      assert.equal((await request(internal,'GET',null,undefined,{path:'/api/interno/operaciones',bearer:token,query})).status,400)
    assert.equal(JSON.stringify((await models.SolicitudRevision.findByPk(before.id)).contenido),original)
    assert.equal((await models.Programacion.findOne({where:{solicitud_id:order.id},order:[['id','DESC']]})).anticipo_minutos_aplicado,300)
    const canceled={request_id:randomUUID(),tipo:'CANCELAR',motivo:'Ya no se necesita recogida',datos:{}}
    let pending=await request(router,'POST',a,canceled,{path})
    assert.equal(pending.status,201)
    const cid=pending.data.cambios[0].public_id
    // Una intención pendiente impide volver a enviar una creación a WMS.
    await assert.rejects(()=>modules.cambiosOperaciones.canIntegrate(order),{code:'CANCELACION_PENDIENTE'})
    uncertainCancel=true
    await modules.cambiosOperaciones.decide(saved.public_id,cid,apply,{...internalIdentity,bearer:token},context)
    assert.equal((await modules.operaciones.detail(a,saved.public_id)).cambios[0].estado,'CONCILIAR')
    await modules.cambiosOperaciones.decide(saved.public_id,cid,apply,{...internalIdentity,bearer:token},context)
    assert.equal(cancelCalls.length,1);assert.equal(cancelCalls[0].bearer,token)
    remote.get(saved.public_id).estado='CANCELADO'
    await modules.cambiosOperaciones.decide(saved.public_id,cid,apply,internalIdentity,context)
    assert.equal((await modules.operaciones.detail(a,saved.public_id)).estado,'CANCELADA')
    assert.equal((await models.Solicitud.findByPk(order.id)).estado,'CANCELADA')
    const another=await modules.operaciones.create(a,{...input,request_id:randomUUID()},context)
    pending=await request(router,'POST',a,{...canceled,request_id:randomUUID()},{path:'/'+another.public_id+'/cambios'})
    uncertainCancel=false
    await modules.cambiosOperaciones.decide(another.public_id,pending.data.cambios[0].public_id,apply,internalIdentity,context)
    assert.equal((await modules.operaciones.detail(a,another.public_id)).cambios[0].estado,'APLICADO')
    assert.equal(cancelCalls.length,2)
    const third=await modules.operaciones.create(a,{...input,request_id:randomUUID()},context)
    pending=await request(router,'POST',a,{...canceled,request_id:randomUUID()},{path:'/'+third.public_id+'/cambios'})
    const tid=pending.data.cambios[0].public_id
    await assert.rejects(()=>modules.cambiosOperaciones.decide(third.public_id,tid,{decision:'RECHAZAR',motivo:null},internalIdentity,context),{code:'MOTIVO_REQUERIDO'})
    await modules.cambiosOperaciones.decide(third.public_id,tid,{decision:'RECHAZAR',motivo:'Carga ya coordinada, contacta bodega'},internalIdentity,context)
    assert.equal((await modules.operaciones.detail(a,third.public_id)).cambios[0].estado,'RECHAZADO')
    remote.get(third.public_id).estado='DESPACHADO'
    assert.equal((await request(router,'POST',a,{...canceled,request_id:randomUUID()},{path:'/'+third.public_id+'/cambios'})).status,409)
    const event=await models.EventoAuditoria.findOne({where:{codigo_evento:'CAMBIO_OPERACION_SOLICITADO',actor_id:a.actor_id}})
    assert.equal(String(event.sesion_id),a.sesion_id)
    assert.equal(JSON.parse(JSON.stringify(updated)).detalles[0].cantidad,'0.1')
  })
  await t.test('Recogida de 400 productos a través del parser HTTP real, conservando límites de seguridad', async () => {
    const { createApp }=require('../src/app')
    const { IncomingMessage, ServerResponse }=require('node:http')
    const { Duplex }=require('node:stream')
    const rows=Array.from({length:400},(_,index)=>({inventario_id:index+20000,lote_producto_id:'LP_BULK_'+index,lote_id:'GEN_BULK',producto_id:'CAJ_BULK_'+index,
      nombre:'Producto '+index,referencia:'R',unidad_medida:'unidades',cantidad:'2',actualizado_at:null}))
    const previousInventory=wms.inventory
    const remote=new Map(),posts=[]
    wms.inventory=async id=>id==='empresa-a'?rows:[]
    wms.operations=()=>({validateClient:wms.validateClient,obtain:async id=>remote.get(id)||null,statuses:async ids=>ids.map(id=>remote.get(id)).filter(Boolean),
      create:async body=>{posts.push(body);const result={request_id:body.request_id,id_cliente:body.id_cliente,id_alistamiento:300,estado:'ABIERTO',etapa:'PENDIENTE'};remote.set(body.request_id,result);return result}})
    const app=await createApp({config,db,wms,logger:{info(){},warn(){},error(){}}})
    function httpJSON(url,body) {
      return new Promise((resolve,reject)=>{
        const chunks=[],bytes=Buffer.from(JSON.stringify(body))
        const socket=new Duplex({read(){},write(chunk,encoding,callback){chunks.push(Buffer.from(chunk));callback()}})
        socket.remoteAddress='127.0.0.1'
        const req=new IncomingMessage(socket)
        req.method='POST';req.url=url;req.httpVersion='1.1';req.complete=true
        req.headers={host:'localhost','content-type':'application/json','content-length':String(bytes.length),
          cookie:`${config.cookie.sessionName}=${a.token}; ${config.cookie.deviceName}=${a.deviceToken}`,'x-csrf-token':security.csrf(a.token)}
        req.rawHeaders=Object.entries(req.headers).flat()
        const res=new ServerResponse(req);res.assignSocket(socket);res.on('error',reject)
        const timer=setTimeout(()=>{socket.destroy();reject(new Error('Petición en memoria sin finalizar: '+url))},5000)
        res.on('finish',()=>{clearTimeout(timer);const raw=Buffer.concat(chunks).toString('utf8'),responseBody=raw.split('\r\n\r\n').slice(1).join('\r\n\r\n');resolve({status:res.statusCode,data:JSON.parse(responseBody)});socket.destroy()})
        app.handle(req,res);req.push(bytes);req.push(null)
      })
    }
    const input={request_id:randomUUID(),nombre:'Retiro completo del inventario',modalidad:'RECOGIDA',fecha_programada_at:new Date(Date.now()+86400000-5*3600000).toISOString().slice(0,10)+'T15:00:00-05:00',
      destinatario:'Conductor de prueba',direccion_entrega:null,observacion:null,detalles:rows.map(row=>({codigo_wms:row.producto_id,wms_lote_id:row.lote_id,cantidad:row.cantidad}))}
    try {
      assert.ok(Buffer.byteLength(JSON.stringify(input))>config.http.bodyLimitBytes)
      const response=await httpJSON('/api/operaciones',input)
      assert.equal(response.status,201,JSON.stringify(response.data))
      assert.equal(response.data.detalles.length,400)
      assert.equal(response.data.wms_alistamiento_id,300)
      assert.equal(posts[0].items.length,400)
      assert.equal((await httpJSON('/api/operaciones',input)).data.public_id,response.data.public_id)
      assert.equal(posts.length,1)
      const listing=await modules.operaciones.list(a,{})
      const summary=listing.data.find(row=>row.public_id===response.data.public_id)
      assert.equal(summary.total_productos,400)
      assert.equal(Object.hasOwn(summary,'detalles'),false)
      const { createRoutes } = require('../src/routes')
      const internal = createRoutes({ config, db, security, modules, limiters: { login: (req,res,next)=>next(), password: (req,res,next)=>next() } })
      const operatorToken = 'Bearer '+jwt.sign({ id_usuario: 7, username: 'bodega.fixture', id_personal: 'P7', permisos: {gestionBodega:true} },config.wms.jwtSecret,{expiresIn:'1h'})
      const internalOptions = { path: '/api/interno/operaciones', bearer: operatorToken }
      const inbox = await request(internal,'GET',null,undefined,internalOptions)
      assert.equal(inbox.status,200,inbox.error?.stack)
      assert.ok(inbox.data.data.every(row => row.cliente_nombre && !Object.hasOwn(row,'detalles')))
      assert.equal(inbox.data.data.find(row => row.public_id === response.data.public_id).total_productos,400)
      const page2 = await request(internal,'GET',null,undefined,{...internalOptions,query:{page:'2',limit:'1'}})
      assert.equal(page2.data.total,inbox.data.total)
      assert.equal(page2.data.data.length,1)
      const search = await request(internal,'GET',null,undefined,{...internalOptions,query:{buscar:'Retiro completo'}})
      assert.equal(search.status,200,search.error?.stack)
      assert.equal(search.data.total,1)
      assert.equal(search.data.data[0].public_id,response.data.public_id)
      const noMatch = await request(internal,'GET',null,undefined,{...internalOptions,query:{buscar:"' OR 1=1 --"}})
      assert.equal(noMatch.data.total,0)
      const internalDetail = await request(internal,'GET',null,undefined,{...internalOptions,path:internalOptions.path+'/'+response.data.public_id})
      assert.equal(internalDetail.status,200)
      assert.equal(internalDetail.data.detalles.length,400)
      assert.equal(internalDetail.data.estado,'PENDIENTE')
      remote.get(response.data.public_id).etapa='LISTO'
      assert.equal((await request(internal,'GET',null,undefined,{...internalOptions,path:internalOptions.path+'/'+response.data.public_id})).data.estado,'LISTO')
      assert.equal((await request(internal,'GET',null,undefined,{...internalOptions,bearer:undefined})).status,401)
      assert.equal((await request(internal,'GET',null,undefined,{...internalOptions,bearer:bearer(false)})).status,403)
      assert.equal((await request(internal,'GET',null,undefined,{...internalOptions,path:'/api/interno/usuarios'})).status,403)
      assert.equal((await request(internal,'GET',null,undefined,{...internalOptions,query:{estado:'LISTO'}})).status,400)
      const schedule=await models.Programacion.findOne({where:{solicitud_id:(await models.Solicitud.findOne({where:{public_id:response.data.public_id}})).id}})
      assert.equal(schedule.anticipo_minutos_aplicado,300)
      assert.ok(+new Date(input.fecha_programada_at)-+schedule.plazo_validado_at>=300*60000)
      assert.equal((await httpJSON('/api/precargas',input)).status,413)
      assert.equal((await httpJSON('/api/operaciones',{...input,observacion:'x'.repeat(config.operations.bodyLimitBytes)})).status,413)
      const injected=structuredClone(input);injected.detalles[399].constructor='inyeccion'
      assert.equal((await httpJSON('/api/operaciones',injected)).data.error.code,'CLAVE_NO_PERMITIDA')
      assert.equal((await httpJSON('/api/operaciones',{...input,modalidad:'ENTREGA'})).status,400)
    } finally { wms.inventory=previousInventory }
  })
  await t.test('Movimientos: sesión real ORM, consulta permitida, aislamiento y solo lectura', async () => {
    const calls = []
    wms.movements = async (id) => {
      calls.push(id)
      return id === 'empresa-a' ? [{ id: '1', tipo: 'SALIDA', fecha: '2026-10-20T05:00:00.000Z',
        codigo_wms: 'LEG001', nombre: 'Producto sin stock ni catálogo', referencia_wms: 'ANTERIOR',
        wms_lote_id: 'GEN_HISTORICO', cantidad: '10.5', unidad_medida: 'unidades' }] : []
    }
    const router = createMovimientoRoutes({ controller: createMovimientoController(modules.movimientos), middleware })
    assert.equal((await request(router, 'GET', null)).status, 401)
    assert.equal((await request(router, 'GET', provisional)).status, 401)
    const view = await request(router, 'GET', a, undefined, { query: { page: '1', limit: '25' } })
    assert.equal(view.status, 200, JSON.stringify(view)); assert.equal(view.data.total, 1)
    assert.equal(view.data.data[0].nombre, 'Producto sin stock ni catálogo')
    assert.equal((await request(router, 'GET', reader)).data.total, 1)
    assert.equal((await request(router, 'GET', b)).data.total, 0)
    assert.equal(calls.at(-1), 'empresa-b')
    const count = calls.length
    for (const query of [{ cliente_id: b.cliente_id }, { buscar: { $ne: null } }, { desde: '2026-02-30' }])
      assert.equal((await request(router, 'GET', a, undefined, { query })).status, 400)
    assert.equal(calls.length, count)
    assert.equal((await request(router, 'POST', a, {})).status, 404)
    const denied = createMovimientoRoutes({ controller: createMovimientoController(modules.movimientos),
      middleware: createAuthMiddleware({ security, sesiones: { authenticate: async () => ({ ...a, tipo: 'PROVISIONAL' }) },
        terminos: modules.terminos, cookies: { sessionToken: () => a.token, deviceToken: () => a.deviceToken } }) })
    assert.equal((await request(denied, 'GET', a)).status, 403)
    wms.movements = async () => { throw Object.assign(new Error('WMS no disponible'), { status: 503 }) }
    assert.equal((await request(router, 'GET', a)).status, 503)
  })
  await t.test('Documentos: ORM verifica cliente y permisos y guarda usuario, sesión, dispositivo y hash sin almacenar archivos', async () => {
    const writes = [], content = Buffer.from('%PDF-1.4\nfixture-documental\n%%EOF')
    wms.documents = () => ({
      list: async (id) => ({ data: id === 'empresa-a' ? [{ tipo: 'rut', nombre: 'RUT', estado: 'ADJUNTO', nombre_archivo: 'rut.pdf', path: '/privado/rut.pdf' }] : [], actualizado_at: '2026-10-20T17:00:00Z' }),
      file: async (id, type) => { assert.equal(id, 'empresa-a'); assert.equal(type, 'rut'); return { buffer: content, mime: 'application/pdf', filename: 'rut.pdf' } },
      update: async (id, type, buffer) => { writes.push({ id, type }); assert.deepEqual(buffer, content); return { anterior: type === 'rut' ? '/wms/rut-anterior.pdf' : null, actual: '/wms/' + type + '-nuevo.pdf' } },
    })
    const view = await modules.documentos.list(a, { page: '1', limit: '25' })
    assert.equal(view.total, 1); assert.equal(Object.hasOwn(view.data[0], 'path'), false)
    assert.equal((await modules.documentos.list(b, {})).total, 0)
    assert.equal((await modules.documentos.list(reader, {})).permite_carga, false)
    await modules.documentos.file(a, 'rut', context)
    assert.deepEqual(await modules.documentos.update(a, 'rut', content, 'application/pdf', context), { actualizado: true })
    const event = await models.EventoAuditoria.findOne({ where: { codigo_evento: 'DOCUMENTO_ACTUALIZADO', cliente_id: a.cliente_id } })
    assert.equal(String(event.actor_id), String(a.actor_id)); assert.equal(String(event.sesion_id), a.sesion_id)
    assert.equal(event.detalle_interno.dispositivo_id, a.dispositivo_id)
    assert.match(event.detalle_interno.contenido_sha256, /^[a-f0-9]{64}$/)
    assert.equal(JSON.stringify(event.detalle_interno).includes('fixture-documental'), false)
    await modules.documentos.update(a, 'camara_comercio', content, 'application/pdf', context)
    const created = await models.EventoAuditoria.findOne({ where: { codigo_evento: 'DOCUMENTO_CARGADO', cliente_id: a.cliente_id } })
    assert.equal(created.entidad_id, 'camara_comercio')
    assert.equal(created.detalle_interno.anterior_wms, null)
    await assert.rejects(modules.documentos.update(reader, 'rut', content, 'application/pdf', context), { status: 403 })
    assert.equal(writes.length, 2)
  })
  await t.test(
    'Términos nuevos y sesiones revocadas bloquean las escrituras',
    async () => {
      const previousCount = await models.Producto.count()
      await modules.terminos.publish(
        {
          version: 'fixture-2',
          titulo: 'Prueba',
          contenido: 'Nueva versión de prueba.',
        },
        identity,
        context,
      )
      const response = await request(productRouter, 'POST', a, {
        ...productInput,
        request_id: randomUUID(),
      })
      assert.equal(response.status, 403)
      assert.equal(response.error.code, 'TERMINOS_REQUERIDOS')
      const movements = createMovimientoRoutes({ controller: createMovimientoController(modules.movimientos), middleware })
      assert.equal((await request(movements, 'GET', a)).error.code, 'TERMINOS_REQUERIDOS')
      await modules.sesiones.revokeForUser(a.id, 'PRUEBA')
      assert.equal((await request(movements, 'GET', a)).status, 401)
      assert.equal((await request(productRouter, 'GET', a)).status, 401)
      assert.equal(await models.Producto.count(), previousCount)
    },
  )
})
