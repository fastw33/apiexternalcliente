const { DataTypes } = require('sequelize')
const { id, reference, createdAt } = require('../../models/fields')
module.exports = (sequelize) =>
  sequelize.define(
    'Programacion',
    {
      id: id(),
      cliente_id: reference(),
      solicitud_id: reference(),
      fecha_solicitada_at: { type: DataTypes.DATE(6), allowNull: false },
      fecha_confirmada_at: { type: DataTypes.DATE(6), allowNull: true },
      estado: {
        type: DataTypes.ENUM(
          'SOLICITADA',
          'CONFIRMADA',
          'REEMPLAZADA',
          'CANCELADA',
        ),
        allowNull: false,
        defaultValue: 'SOLICITADA',
      },
      anticipo_minutos_aplicado: {
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: true,
      },
      plazo_validado_at: { type: DataTypes.DATE(6), allowNull: true },
      creado_por_actor_id: reference(),
      confirmado_por_actor_id: reference(true),
      motivo_cambio: { type: DataTypes.STRING(1000), allowNull: true },
      creado_at: createdAt(),
    },
    { tableName: 'programaciones', timestamps: false },
  )
