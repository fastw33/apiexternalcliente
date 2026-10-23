const { DataTypes } = require('sequelize')
const { id,reference,createdAt } = require('../../models/fields')

module.exports = sequelize => sequelize.define('EventoAuditoria',{
  id:id(),cliente_id:reference(true),actor_id:reference(true),sesion_id:reference(true),solicitud_id:reference(true),
  correlation_id:{type:DataTypes.CHAR(36),allowNull:false},codigo_evento:{type:DataTypes.STRING(100),allowNull:false},
  entidad_tipo:{type:DataTypes.STRING(80),allowNull:false},entidad_id:{type:DataTypes.STRING(250),allowNull:false},
  estado_anterior:{type:DataTypes.STRING(80),allowNull:true},estado_nuevo:{type:DataTypes.STRING(80),allowNull:true},
  visibilidad:{type:DataTypes.ENUM('INTERNA','CLIENTE'),allowNull:false,defaultValue:'INTERNA'},
  mensaje_cliente:{type:DataTypes.STRING(500),allowNull:true},detalle_interno:{type:DataTypes.JSON,allowNull:true},
  ip_origen:{type:DataTypes.STRING(45),allowNull:true},navegador:{type:DataTypes.STRING(500),allowNull:true},
  creado_at:createdAt(),
},{tableName:'eventos_auditoria',timestamps:false})
