const { DataTypes } = require('sequelize')
const { id, reference } = require('../../models/fields')
module.exports = sequelize =>
  sequelize.define(
    'PrecargaDetalle',
    {
      id: id(),
      cliente_id: reference(),
      solicitud_id: reference(),
      precarga_lote_id: reference(),
      cliente_producto_id: reference(),
      producto_id: reference(),
      producto_version_id: reference(),
      cantidad_declarada: { type: DataTypes.DECIMAL(20, 6), allowNull: false },
      peso_unitario_kg: { type: DataTypes.DECIMAL(18, 6), allowNull: true },
      observacion: { type: DataTypes.STRING(1000), allowNull: true },
    },
    { tableName: 'precarga_detalles', timestamps: false }
  )
