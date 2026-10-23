const { DataTypes } = require('sequelize')
const { id, reference, createdAt } = require('../../models/fields')

module.exports = sequelize =>
  sequelize.define(
    'Producto',
    {
      id: id(),
      codigo_maestro: {
        type: DataTypes.STRING(80),
        allowNull: false,
        unique: true,
      },
      estado: {
        type: DataTypes.ENUM('PROPUESTO', 'VALIDADO', 'INACTIVO'),
        allowNull: false,
        defaultValue: 'PROPUESTO',
      },
      creado_por_actor_id: reference(),
      creado_at: createdAt(),
      actualizado_at: createdAt(),
    },
    {
      tableName: 'productos',
      timestamps: true,
      createdAt: 'creado_at',
      updatedAt: 'actualizado_at',
    }
  )
