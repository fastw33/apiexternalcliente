const { DataTypes } = require('sequelize')
const { id, reference } = require('../../models/fields')
module.exports = sequelize =>
  sequelize.define(
    'DecisionSolicitud',
    {
      id: id(),
      cliente_id: reference(),
      solicitud_id: reference(),
      numero_revision: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      decision: {
        type: DataTypes.ENUM('APROBADA', 'OBSERVADA', 'RECHAZADA'),
        allowNull: false,
      },
      motivo: { type: DataTypes.STRING(1000), allowNull: true },
      decidido_por_actor_id: reference(),
      decidido_at: { type: DataTypes.DATE(6), allowNull: false },
    },
    { tableName: 'decisiones_solicitud', timestamps: false }
  )
