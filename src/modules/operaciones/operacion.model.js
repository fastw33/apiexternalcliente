const { DataTypes } = require('sequelize')
const { reference } = require('../../models/fields')
module.exports = (sequelize) =>
  sequelize.define(
    'Operacion',
    {
      solicitud_id: { ...reference(), primaryKey: true },
      cliente_id: reference(),
      tipo_solicitud: {
        type: DataTypes.ENUM('PRECARGA', 'ALISTAMIENTO', 'SERVICIO'),
        allowNull: false,
        defaultValue: 'ALISTAMIENTO',
      },
      modalidad: {
        type: DataTypes.ENUM('RECOGIDA', 'ENTREGA'),
        allowNull: false,
      },
      destinatario: { type: DataTypes.STRING(250), allowNull: true },
      direccion_entrega: { type: DataTypes.STRING(500), allowNull: true },
      wms_alistamiento_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        unique: true,
      },
    },
    { tableName: 'alistamientos', timestamps: false },
  )
