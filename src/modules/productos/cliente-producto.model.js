const { DataTypes } = require('sequelize')
const { id, reference, createdAt } = require('../../models/fields')

module.exports = (sequelize) =>
  sequelize.define(
    'ClienteProducto',
    {
      id: id(),
      cliente_id: reference(),
      producto_id: reference(),
      codigo_cliente: { type: DataTypes.STRING(120), allowNull: false },
      alias_cliente: { type: DataTypes.STRING(250), allowNull: true },
      retirado_at: {
        type: DataTypes.DATE(6),
        allowNull: true,
        defaultValue: null,
      },
      estado: {
        type: DataTypes.ENUM('PENDIENTE', 'HABILITADO', 'DESHABILITADO'),
        allowNull: false,
        defaultValue: 'PENDIENTE',
      },
      creado_por_actor_id: reference(),
      creado_at: createdAt(),
      actualizado_at: createdAt(),
    },
    {
      tableName: 'cliente_producto',
      timestamps: true,
      createdAt: 'creado_at',
      updatedAt: 'actualizado_at',
      indexes: [
        { unique: true, fields: ['cliente_id', 'codigo_cliente'] },
        { unique: true, fields: ['cliente_id', 'producto_id'] },
      ],
    },
  )
