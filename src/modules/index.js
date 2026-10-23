const { createAuditoriaService } = require('./auditoria/auditoria.service')
const { createActorService } = require('./actores/actor.service')
const {
  createDispositivoService,
} = require('./dispositivos/dispositivo.service')
const { createSesionService } = require('./sesiones/sesion.service')
const { createClienteService } = require('./clientes/cliente.service')
const { createUsuarioService } = require('./usuarios/usuario.service')
const { createAuthService } = require('./auth/auth.service')
const { createTerminosService } = require('./terminos/terminos.service')
const {
  createProductoBodegaService,
} = require('./productos/producto-bodega.service')
const { createProductoService } = require('./productos/producto.service')
const { createPrecargaService } = require('./precargas/precarga.service')
const {
  createPrecargaReadService,
} = require('./precargas/precarga-read.service')
const {
  createPrecargaLoteService,
} = require('./precargas/precarga-lote.service')
const { createInventarioService } = require('./inventario/inventario.service')
const { createDocumentoService } = require('./documentos/documento.service')
const { createMovimientoService } = require('./movimientos/movimiento.service')
const { createOperacionService } = require('./operaciones/operacion.service')
const {
  createOperacionCambioService,
} = require('./operaciones/operacion-cambio.service')
const {
  createOperacionInternoService,
} = require('./operaciones/operacion-interno.service')
const { createIngresoService } = require('./precargas/ingreso.service')
const {
  createProductoInternoService,
} = require('./productos/producto-interno.service')

function createModules(dependencies) {
  const common = { ...dependencies, models: dependencies.db.models }
  const auditoria = createAuditoriaService(common)
  const actores = createActorService(common)
  const dispositivos = createDispositivoService(common)
  const sesiones = createSesionService({ ...common, auditoria })
  const clientes = createClienteService({ ...common, actores, auditoria })
  const usuarios = createUsuarioService({
    ...common,
    clientes,
    actores,
    auditoria,
    sesiones,
  })
  const terminos = createTerminosService({
    ...common,
    actores,
    auditoria,
    sesiones,
  })
  const auth = createAuthService({
    ...common,
    auditoria,
    dispositivos,
    sesiones,
    terminos,
  })
  const productosInternos = createProductoInternoService({
    ...common,
    actores,
    auditoria,
    sesiones,
    terminos,
  })
  const bodega = createProductoBodegaService({ ...common, auditoria })
  const productos = createProductoService({
    ...common,
    auditoria,
    sesiones,
    terminos,
    bodega,
    productosInternos,
  })
  const precargasInternas = createPrecargaReadService(common)
  const lotesPrecargas = createPrecargaLoteService({
    ...common,
    actores,
    auditoria,
    sesiones,
    terminos,
    read: precargasInternas,
  })
  const precargas = createPrecargaService({
    ...common,
    auditoria,
    sesiones,
    terminos,
    lotes: lotesPrecargas,
  })
  const inventario = createInventarioService(common)
  const movimientos = createMovimientoService(common)
  const documentos = createDocumentoService({
    ...common,
    sesiones,
    terminos,
    auditoria,
  })
  const cambiosOperaciones = createOperacionCambioService({
    ...common,
    sesiones,
    terminos,
    actores,
    auditoria,
  })
  const operaciones = createOperacionService({
    ...common,
    sesiones,
    terminos,
    auditoria,
    cambios: cambiosOperaciones,
  })
  const ingresos = createIngresoService({ precargas: precargasInternas })
  const operacionesInternas = createOperacionInternoService({
    ...common,
    operaciones,
    ingresos,
    cambios: cambiosOperaciones,
  })
  for (const modulo of Object.keys({
    auditoria,
    actores,
    dispositivos,
    sesiones,
    clientes,
    usuarios,
    terminos,
    auth,
    productos,
    precargas,
    productosInternos,
    precargasInternas,
    lotesPrecargas,
    inventario,
    movimientos,
    documentos,
    operaciones,
    operacionesInternas,
    cambiosOperaciones,
  })) {
    dependencies.logger?.info('MODULO_CARGADO', { modulo })
  }
  return {
    auth,
    usuarios,
    clientes,
    sesiones,
    terminos,
    productos,
    precargas,
    productosInternos,
    precargasInternas,
    lotesPrecargas,
    inventario,
    movimientos,
    documentos,
    operaciones,
    operacionesInternas,
    cambiosOperaciones,
  }
}
module.exports = { createModules }
