const { DataTypes } = require('sequelize')
const { id, reference, createdAt } = require('../../models/fields')

module.exports = sequelize =>
  sequelize.define(
    'ProductoVersion',
    {
      id: id(),
      producto_id: reference(),
      numero_version: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      nombre: { type: DataTypes.STRING(250), allowNull: false },
      referencia: { type: DataTypes.STRING(250), allowNull: false },
      tipo: { type: DataTypes.STRING(250), allowNull: false },
      prefijo: { type: DataTypes.STRING(80), allowNull: true },
      unidad_medida: { type: DataTypes.STRING(15), allowNull: false },
      alto_cm: { type: DataTypes.DECIMAL(14, 4), allowNull: false },
      ancho_cm: { type: DataTypes.DECIMAL(14, 4), allowNull: false },
      largo_cm: { type: DataTypes.DECIMAL(14, 4), allowNull: false },
      estado: {
        type: DataTypes.ENUM('PROPUESTA', 'HOMOLOGADA', 'RETIRADA'),
        allowNull: false,
        defaultValue: 'PROPUESTA',
      },
      creado_por_actor_id: reference(),
      homologado_por_actor_id: reference(true),
      homologado_at: { type: DataTypes.DATE(6), allowNull: true },
      creado_at: createdAt(),
    },
    {
      tableName: 'producto_versiones',
      timestamps: false,
      indexes: [{ unique: true, fields: ['producto_id', 'numero_version'] }],
    }
  )
