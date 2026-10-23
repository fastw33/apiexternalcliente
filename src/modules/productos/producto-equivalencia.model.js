const { DataTypes } = require('sequelize')
const { id, reference, createdAt } = require('../../models/fields')

module.exports = (sequelize) =>
  sequelize.define(
    'ProductoEquivalencia',
    {
      id: id(),
      producto_version_id: { ...reference(), unique: true },
      wms_producto_id: {
        type: DataTypes.STRING(250),
        allowNull: false,
      },
      validado_por_actor_id: reference(),
      validado_at: { type: DataTypes.DATE(6), allowNull: false },
      creado_at: createdAt(),
    },
    { tableName: 'producto_equivalencia_wms', timestamps: false },
  )
