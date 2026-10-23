const { DataTypes } = require('sequelize')
const { id, reference, createdAt, binary32 } = require('../../models/fields')
module.exports = sequelize =>
  sequelize.define(
    'ComandoIdempotente',
    {
      id: id(),
      cliente_id: reference(),
      actor_id: reference(),
      operacion: { type: DataTypes.STRING(80), allowNull: false },
      clave: { type: DataTypes.STRING(128), allowNull: false },
      peticion_sha256: binary32(),
      estado: {
        type: DataTypes.ENUM('EN_CURSO', 'COMPLETADO'),
        allowNull: false,
        defaultValue: 'EN_CURSO',
      },
      solicitud_id: reference(true),
      resultado_seguro: { type: DataTypes.JSON, allowNull: true },
      creado_at: createdAt(),
      expira_at: { type: DataTypes.DATE(6), allowNull: false },
    },
    {
      tableName: 'comandos_idempotentes',
      timestamps: false,
      indexes: [
        {
          unique: true,
          fields: ['cliente_id', 'actor_id', 'operacion', 'clave'],
        },
      ],
    }
  )
