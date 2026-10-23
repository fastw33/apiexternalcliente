const { DataTypes } = require('sequelize')
const { id, reference, createdAt, binary32 } = require('../../models/fields')
module.exports = (sequelize) =>
  sequelize.define(
    'OperacionCambio',
    {
      id: id(),
      public_id: { type: DataTypes.CHAR(36), allowNull: false, unique: true },
      request_id: { type: DataTypes.CHAR(36), allowNull: false },
      cliente_id: reference(),
      solicitud_id: reference(),
      tipo: {
        type: DataTypes.ENUM('CANCELAR', 'REPROGRAMAR', 'CORREGIR'),
        allowNull: false,
      },
      estado: {
        type: DataTypes.ENUM(
          'SOLICITADO',
          'EN_PROCESO',
          'APLICADO',
          'RECHAZADO',
          'CONCILIAR',
        ),
        allowNull: false,
        defaultValue: 'SOLICITADO',
      },
      datos: { type: DataTypes.JSON, allowNull: false },
      motivo: { type: DataTypes.STRING(1000), allowNull: false },
      peticion_sha256: binary32(),
      creado_por_actor_id: reference(),
      decidido_por_actor_id: reference(true),
      motivo_decision: { type: DataTypes.STRING(1000), allowNull: true },
      creado_at: createdAt(),
      decidido_at: { type: DataTypes.DATE(6), allowNull: true },
    },
    { tableName: 'operacion_cambios', timestamps: false },
  )
