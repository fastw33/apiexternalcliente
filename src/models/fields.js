const { DataTypes } = require('sequelize')

const id = () => ({ type:DataTypes.BIGINT.UNSIGNED,primaryKey:true,autoIncrement:true,allowNull:false })
const reference = (allowNull=false) => ({ type:DataTypes.BIGINT.UNSIGNED,allowNull })
const createdAt = () => ({ type:DataTypes.DATE(6),allowNull:false,defaultValue:DataTypes.NOW })
const binary32 = () => ({
  type:'BINARY(32)',allowNull:false,
  validate:{ binaryLength(value) {
    if (!Buffer.isBuffer(value) || value.length !== 32) throw new Error('Se requiere un hash de 32 bytes.')
  } },
})
module.exports = { id,reference,createdAt,binary32 }
