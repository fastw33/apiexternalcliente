const { DataTypes } = require('sequelize')
const { id,createdAt } = require('../../models/fields')

module.exports = sequelize => sequelize.define('Cliente',{
  id:id(),
  wms_cliente_id:{type:DataTypes.STRING(250),allowNull:false,unique:true},
  nombre_presentacion:{type:DataTypes.STRING(250),allowNull:false},
  habilitado:{type:DataTypes.BOOLEAN,allowNull:false,defaultValue:false},
  wms_activo_ultima_validacion:{type:DataTypes.BOOLEAN,allowNull:true},
  validado_wms_at:{type:DataTypes.DATE(6),allowNull:true},
  creado_at:createdAt(),
  actualizado_at:createdAt(),
},{tableName:'clientes_vinculados',timestamps:true,createdAt:'creado_at',updatedAt:'actualizado_at'})
