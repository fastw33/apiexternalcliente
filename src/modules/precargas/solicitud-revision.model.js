const { DataTypes } = require('sequelize')
const { id, reference, binary32 } = require('../../models/fields')
module.exports = sequelize =>
  sequelize.define(
    'SolicitudRevision',
    {
      id: id(),
      cliente_id: reference(),
      solicitud_id: reference(),
      numero_revision: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      contenido: { type: DataTypes.JSON, allowNull: false },
      contenido_sha256: binary32(),
      enviado_por_actor_id: reference(),
      enviado_at: { type: DataTypes.DATE(6), allowNull: false },
    },
    {
      tableName: 'solicitud_revisiones',
      timestamps: false,
      indexes: [
        {
          unique: true,
          fields: ['cliente_id', 'solicitud_id', 'numero_revision'],
        },
      ],
    }
  )
