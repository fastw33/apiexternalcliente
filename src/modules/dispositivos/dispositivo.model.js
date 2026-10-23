const { DataTypes } = require('sequelize')
const { id,reference,createdAt,binary32 } = require('../../models/fields')

module.exports = sequelize => sequelize.define('Dispositivo',{
  id:id(),cliente_id:reference(),usuario_id:reference(),identificador_hash:binary32(),
  nombre:{type:DataTypes.STRING(120),allowNull:true},navegador:{type:DataTypes.STRING(500),allowNull:true},
  ultimo_uso_at:{type:DataTypes.DATE(6),allowNull:true},revocado_at:{type:DataTypes.DATE(6),allowNull:true},
  creado_at:createdAt(),
},{tableName:'dispositivos',timestamps:false})
