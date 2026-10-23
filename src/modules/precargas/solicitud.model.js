const { DataTypes } = require('sequelize')
const { id, reference, createdAt } = require('../../models/fields')
module.exports = sequelize =>
  sequelize.define(
    'Solicitud',
    {
      id: id(),
      public_id: { type: DataTypes.CHAR(36), allowNull: false, unique: true },
      cliente_id: reference(),
      tipo: {
        type: DataTypes.ENUM('PRECARGA', 'ALISTAMIENTO', 'SERVICIO'),
        allowNull: false,
      },
      estado: {
        type: DataTypes.ENUM(
          'BORRADOR',
          'ENVIADA',
          'OBSERVADA',
          'APROBADA',
          'RECHAZADA',
          'CANCELACION_SOLICITADA',
          'CANCELADA',
          'CERRADA'
        ),
        allowNull: false,
        defaultValue: 'BORRADOR',
      },
      revision_actual: {
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: false,
        defaultValue: 1,
      },
      revision_aprobada: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      version_lock: {
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: false,
        defaultValue: 1,
      },
      observacion_cliente: { type: DataTypes.TEXT, allowNull: true },
      creado_por_actor_id: reference(),
      creado_at: createdAt(),
      actualizado_at: createdAt(),
    },
    {
      tableName: 'solicitudes',
      timestamps: true,
      createdAt: 'creado_at',
      updatedAt: 'actualizado_at',
    }
  )
