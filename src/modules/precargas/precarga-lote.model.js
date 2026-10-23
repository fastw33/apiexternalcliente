const { DataTypes } = require('sequelize')
const { id, reference, createdAt } = require('../../models/fields')
module.exports = sequelize =>
  sequelize.define(
    'PrecargaLote',
    {
      id: id(),
      cliente_id: reference(),
      solicitud_id: reference(),
      referencia_cliente: { type: DataTypes.STRING(120), allowNull: false },
      wms_lote_id: {
        type: DataTypes.STRING(250),
        allowNull: true,
        unique: true,
      },
      creado_at: createdAt(),
    },
    {
      tableName: 'precarga_lotes',
      timestamps: false,
      indexes: [
        { unique: true, fields: ['solicitud_id', 'referencia_cliente'] },
      ],
    }
  )
