const { Router } = require('express')
const rules = require('../utils/validation')
const {
  agendaQuery,
} = require('../modules/operaciones/operacion-agenda.validation')
const {
  createOperacionInternoRoutes,
} = require('../modules/operaciones/operacion-interno.routes')
const {
  createOperacionInternoController,
} = require('../modules/operaciones/operacion-interno.controller')
const {
  createDocumentoRoutes,
} = require('../modules/documentos/documento.routes')
const {
  createDocumentoController,
} = require('../modules/documentos/documento.controller')
const {
  createMovimientoRoutes,
} = require('../modules/movimientos/movimiento.routes')
const {
  createMovimientoController,
} = require('../modules/movimientos/movimiento.controller')
const {
  createOperacionRoutes,
} = require('../modules/operaciones/operacion.routes')
const {
  createOperacionController,
} = require('../modules/operaciones/operacion.controller')
const { createSessionCookies } = require('../utils/sessionCookies')
const { createAuthMiddleware } = require('../middlewares/auth.middleware')
const { createAuthController } = require('../modules/auth/auth.controller')
const { createAuthRoutes } = require('../modules/auth/auth.routes')
const {
  createClienteController,
} = require('../modules/clientes/cliente.controller')
const { createClienteRoutes } = require('../modules/clientes/cliente.routes')
const {
  createUsuarioController,
} = require('../modules/usuarios/usuario.controller')
const { createUsuarioRoutes } = require('../modules/usuarios/usuario.routes')
const {
  createSesionController,
} = require('../modules/sesiones/sesion.controller')
const { createSesionRoutes } = require('../modules/sesiones/sesion.routes')
const { createSaludService } = require('../modules/salud/salud.service')
const { createSaludController } = require('../modules/salud/salud.controller')
const { createSaludRoutes } = require('../modules/salud/salud.routes')
const {
  createTerminosController,
} = require('../modules/terminos/terminos.controller')
const {
  createTerminosRoutes,
  createTerminosInternalRoutes,
} = require('../modules/terminos/terminos.routes')
const { validateRequest } = require('../middlewares/validateRequest.middleware')
const {
  createProductoController,
} = require('../modules/productos/producto.controller')
const { createProductoRoutes } = require('../modules/productos/producto.routes')
const {
  createPrecargaController,
} = require('../modules/precargas/precarga.controller')
const { createPrecargaRoutes } = require('../modules/precargas/precarga.routes')
const {
  createPrecargaInternoRoutes,
} = require('../modules/precargas/precarga-interno.routes')
const {
  createPrecargaInternoController,
} = require('../modules/precargas/precarga-interno.controller')
const {
  createInventarioController,
} = require('../modules/inventario/inventario.controller')
const {
  createInventarioRoutes,
} = require('../modules/inventario/inventario.routes')
const {
  createProductoInternoController,
} = require('../modules/productos/producto-interno.controller')
const {
  createProductoInternoRoutes,
} = require('../modules/productos/producto-interno.routes')

function createRoutes({ config, db, security, modules, limiters }) {
  const router = Router()
  const cookies = createSessionCookies(config)
  const middleware = createAuthMiddleware({
    security,
    sesiones: modules.sesiones,
    terminos: modules.terminos,
    cookies,
  })
  router.use(
    '/api/operaciones',
    createOperacionRoutes({
      controller: createOperacionController(
        modules.operaciones,
        modules.cambiosOperaciones,
        modules.operacionesInternas,
      ),
      middleware,
    }),
  )
  const terminosController = createTerminosController(modules.terminos)
  router.use(
    '/api/documentos',
    createDocumentoRoutes({
      config,
      controller: createDocumentoController(modules.documentos),
      middleware,
    }),
  )
  router.use(
    '/api/movimientos',
    createMovimientoRoutes({
      controller: createMovimientoController(modules.movimientos),
      middleware,
    }),
  )
  const authController = createAuthController({ ...modules, cookies })
  const internal = Router()
  router.get(
    '/api/interno/programacion-bodega',
    middleware.internalAgenda,
    validateRequest({ query: agendaQuery }),
    createOperacionInternoController(
      modules.operacionesInternas,
      modules.cambiosOperaciones,
    ).list,
  )
  const precargaInternoController = createPrecargaInternoController(
    modules.precargasInternas,
    modules.lotesPrecargas,
  )
  router.get(
    '/api/interno/lotes/:wms_lote_id/declaracion',
    middleware.internalOperations,
    validateRequest({
      query: {},
      params: { wms_lote_id: rules.text('lote', 250) },
    }),
    precargaInternoController.byLot,
  )
  router.use(
    '/api/interno/operaciones',
    middleware.internalOperations,
    createOperacionInternoRoutes(
      createOperacionInternoController(
        modules.operacionesInternas,
        modules.cambiosOperaciones,
      ),
    ),
  )
  internal.use(middleware.internal)
  internal.get('/me', validateRequest({ query: {} }), authController.internalMe)
  internal.use(
    '/clientes',
    createClienteRoutes(createClienteController(modules.clientes)),
  )
  internal.use(
    '/usuarios',
    createUsuarioRoutes(createUsuarioController(modules.usuarios)),
  )
  internal.use('/terminos', createTerminosInternalRoutes(terminosController))
  internal.use(
    '/productos',
    createProductoInternoRoutes(
      createProductoInternoController(modules.productosInternos),
    ),
  )
  internal.use(
    '/precargas',
    createPrecargaInternoRoutes(precargaInternoController),
  )
  router.use('/api/interno', internal)
  router.use(
    '/api/productos',
    createProductoRoutes({
      controller: createProductoController(modules.productos),
      middleware,
    }),
  )
  router.use(
    '/api/precargas',
    createPrecargaRoutes({
      controller: createPrecargaController(modules.precargas),
      middleware,
    }),
  )
  router.use(
    '/api/inventario',
    createInventarioRoutes({
      controller: createInventarioController(modules.inventario),
      middleware,
    }),
  )
  router.get(
    '/api/terminos',
    validateRequest({ query: {} }),
    terminosController.publicDocument,
  )
  router.use(
    '/api/auth/terminos',
    createTerminosRoutes({ controller: terminosController, middleware }),
  )
  router.use(
    '/api/auth',
    createAuthRoutes({
      config,
      controller: authController,
      middleware,
      limiters,
      sesionRoutes: createSesionRoutes(
        createSesionController({ sesiones: modules.sesiones, cookies }),
        middleware.csrf,
      ),
    }),
  )
  router.use(
    createSaludRoutes(createSaludController(createSaludService({ db }))),
  )
  return router
}
module.exports = { createRoutes }
