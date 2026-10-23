const { DataTypes } = require('sequelize')
const { id,reference,createdAt } = require('../../models/fields')

module.exports = sequelize => sequelize.define('Actor',{
  id:id(),tipo:{type:DataTypes.ENUM('CLIENTE','INTERNO','SERVICIO'),allowNull:false},
  cliente_id:reference(true),wms_usuario_id:{type:DataTypes.INTEGER,allowNull:true,unique:true},
  wms_personal_id:{type:DataTypes.STRING(250),allowNull:true},
  codigo_servicio:{type:DataTypes.STRING(80),allowNull:true,unique:true},
  nombre_presentacion:{type:DataTypes.STRING(250),allowNull:false},creado_at:createdAt(),
},{tableName:'actores',timestamps:false})
