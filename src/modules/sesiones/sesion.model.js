const { DataTypes } = require('sequelize')
const { id,reference,createdAt,binary32 } = require('../../models/fields')

module.exports = sequelize => sequelize.define('Sesion',{
  id:id(),cliente_id:reference(),usuario_id:reference(),dispositivo_id:reference(),secreto_hash:binary32(),
  tipo:{type:DataTypes.ENUM('PROVISIONAL','NORMAL'),allowNull:false},
  version_credenciales:{type:DataTypes.INTEGER.UNSIGNED,allowNull:false},
  ip_inicio:{type:DataTypes.STRING(45),allowNull:false},navegador_inicio:{type:DataTypes.STRING(500),allowNull:false},
  creado_at:createdAt(),ultimo_uso_at:{type:DataTypes.DATE(6),allowNull:false},
  expira_at:{type:DataTypes.DATE(6),allowNull:false},revocada_at:{type:DataTypes.DATE(6),allowNull:true},
  motivo_revocacion:{type:DataTypes.STRING(120),allowNull:true},
},{tableName:'sesiones',timestamps:false,defaultScope:{attributes:{exclude:['secreto_hash']}}})
