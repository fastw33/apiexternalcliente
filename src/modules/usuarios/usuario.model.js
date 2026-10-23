const { DataTypes } = require('sequelize')
const { id,reference,createdAt } = require('../../models/fields')

module.exports = sequelize => sequelize.define('Usuario',{
  id:id(),cliente_id:reference(),actor_id:{...reference(),unique:true},
  username_normalizado:{type:DataTypes.STRING(100),allowNull:false,unique:true},
  correo:{type:DataTypes.STRING(254),allowNull:false,validate:{isEmail:true}},
  password_hash:{type:DataTypes.STRING(255),allowNull:false},
  debe_cambiar_password:{type:DataTypes.BOOLEAN,allowNull:false,defaultValue:true},
  password_temporal_expira_at:{type:DataTypes.DATE(6),allowNull:true},
  password_cambiado_at:{type:DataTypes.DATE(6),allowNull:true},
  version_credenciales:{type:DataTypes.INTEGER.UNSIGNED,allowNull:false,defaultValue:1},
  perfil:{type:DataTypes.ENUM('CONSULTA','SOLICITANTE'),allowNull:false,defaultValue:'SOLICITANTE'},
  estado:{type:DataTypes.ENUM('ACTIVO','SUSPENDIDO','DESACTIVADO'),allowNull:false,defaultValue:'ACTIVO'},
  bloqueado_hasta_at:{type:DataTypes.DATE(6),allowNull:true},creado_por_actor_id:reference(),
  creado_at:createdAt(),actualizado_at:createdAt(),
},{tableName:'usuarios_externos',timestamps:true,createdAt:'creado_at',updatedAt:'actualizado_at',
  defaultScope:{attributes:{exclude:['password_hash']}},
  scopes:{conCredenciales:{attributes:{include:['password_hash']}}},
})
