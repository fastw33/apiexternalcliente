const { DataTypes } = require('sequelize')
const { id,reference,createdAt } = require('../../models/fields')

module.exports = sequelize => sequelize.define('TerminosAceptacion',{
  id:id(),terminos_id:reference(),cliente_id:reference(),usuario_id:reference(),
  sesion_id:reference(),dispositivo_id:reference(),
  autoriza_tratamiento_datos:{type:DataTypes.BOOLEAN,allowNull:false},
  ip_origen:{type:DataTypes.STRING(45),allowNull:false},
  navegador:{type:DataTypes.STRING(500),allowNull:false},
  correlation_id:{type:DataTypes.CHAR(36),allowNull:false},aceptado_at:createdAt(),
},{tableName:'terminos_aceptaciones',timestamps:false})
