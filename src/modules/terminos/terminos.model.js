const { DataTypes } = require('sequelize')
const { id,reference,createdAt } = require('../../models/fields')

module.exports = sequelize => sequelize.define('TerminosVersion',{
  id:id(),
  version:{type:DataTypes.STRING(80),allowNull:false,unique:true},
  titulo:{type:DataTypes.STRING(250),allowNull:false},
  contenido:{type:DataTypes.TEXT('long'),allowNull:false},
  contenido_sha256:{type:DataTypes.CHAR(64),allowNull:false},
  publicado_por_actor_id:reference(),publicado_at:createdAt(),
},{tableName:'terminos_versiones',timestamps:false})
