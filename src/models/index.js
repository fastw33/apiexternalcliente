function initializeModels(sequelize, {operationChanges = require('../config/env').operations.changesEnabled} = {}) {
  const models = {
    Cliente:require('../modules/clientes/cliente.model')(sequelize),
    Actor:require('../modules/actores/actor.model')(sequelize),
    Usuario:require('../modules/usuarios/usuario.model')(sequelize),
    Dispositivo:require('../modules/dispositivos/dispositivo.model')(sequelize),
    Sesion:require('../modules/sesiones/sesion.model')(sequelize),
    EventoAuditoria:require('../modules/auditoria/auditoria.model')(sequelize),
    TerminosVersion:require('../modules/terminos/terminos.model')(sequelize),
    TerminosAceptacion:require('../modules/terminos/aceptacion.model')(sequelize),
    Producto:require('../modules/productos/producto.model')(sequelize),
    ProductoVersion:require('../modules/productos/producto-version.model')(sequelize),
    ClienteProducto:require('../modules/productos/cliente-producto.model')(sequelize),
    ProductoEquivalencia:require('../modules/productos/producto-equivalencia.model')(sequelize),
    Solicitud:require('../modules/precargas/solicitud.model')(sequelize),
    SolicitudRevision:require('../modules/precargas/solicitud-revision.model')(sequelize),
    DecisionSolicitud:require('../modules/precargas/decision.model')(sequelize),
    Precarga:require('../modules/precargas/precarga.model')(sequelize),
    PrecargaLote:require('../modules/precargas/precarga-lote.model')(sequelize),
    PrecargaDetalle:require('../modules/precargas/precarga-detalle.model')(sequelize),
    ComandoIdempotente:require('../modules/precargas/comando-idempotente.model')(sequelize),
    Operacion:require('../modules/operaciones/operacion.model')(sequelize),
    Programacion:require('../modules/operaciones/programacion.model')(sequelize),
    ...(operationChanges ? {OperacionCambio:require('../modules/operaciones/operacion-cambio.model')(sequelize)} : {}),
  }
  const {Cliente,Actor,Usuario,Dispositivo,Sesion,EventoAuditoria} = models
  // Las FK compuestas existentes protegen cliente/recurso. El ORM no cambia el esquema.
  Usuario.belongsTo(Cliente,{as:'cliente',foreignKey:'cliente_id',constraints:false})
  Cliente.hasMany(Usuario,{as:'usuarios',foreignKey:'cliente_id',constraints:false})
  Usuario.belongsTo(Actor,{as:'actor',foreignKey:'actor_id',constraints:false})
  Dispositivo.belongsTo(Usuario,{as:'usuario',foreignKey:'usuario_id',constraints:false})
  Sesion.belongsTo(Usuario,{as:'usuario',foreignKey:'usuario_id',constraints:false})
  Sesion.belongsTo(Dispositivo,{as:'dispositivo',foreignKey:'dispositivo_id',constraints:false})
  EventoAuditoria.belongsTo(Actor,{as:'actor',foreignKey:'actor_id',constraints:false})
  EventoAuditoria.belongsTo(Sesion,{as:'sesion',foreignKey:'sesion_id',constraints:false})
  models.ClienteProducto.belongsTo(models.Producto,{as:'producto',foreignKey:'producto_id',constraints:false})
  models.Producto.hasMany(models.ProductoVersion,{as:'versiones',foreignKey:'producto_id',constraints:false})
  models.Solicitud.belongsTo(Cliente,{as:'clienteOperacion',foreignKey:'cliente_id',constraints:false})
  models.Solicitud.hasOne(models.Operacion,{as:'operacion',foreignKey:'solicitud_id',constraints:false})
  models.Solicitud.hasOne(models.SolicitudRevision,{as:'revisionInicial',foreignKey:'solicitud_id',scope:{numero_revision:1},constraints:false})
  return models
}
module.exports = { initializeModels }
