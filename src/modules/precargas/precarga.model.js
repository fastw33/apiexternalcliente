const { DataTypes } = require('sequelize')
const { reference } = require('../../models/fields')
module.exports = sequelize =>
  sequelize.define(
    'Precarga',
    {
      solicitud_id: { ...reference(), primaryKey: true },
      cliente_id: reference(),
      tipo_solicitud: {
        type: DataTypes.ENUM('PRECARGA', 'ALISTAMIENTO', 'SERVICIO'),
        allowNull: false,
        defaultValue: 'PRECARGA',
      },
      referencia_contenedor: { type: DataTypes.STRING(120), allowNull: true },
      referencia_transporte: { type: DataTypes.STRING(120), allowNull: true },
    },
    { tableName: 'precargas', timestamps: false }
  )
