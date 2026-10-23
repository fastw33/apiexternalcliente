const { DataTypes } = require('sequelize')
const { createConnection } = require('../src/config/db')
async function main() {
  const db = createConnection()
  try {
    if (db.getDatabaseName() !== 'externalclientes')
      throw new Error('Base inesperada')
    const query = db.getQueryInterface(),
      columns = await query.describeTable('alistamientos')
    if (!columns.wms_alistamiento_id) {
      await query.addColumn('alistamientos', 'wms_alistamiento_id', {
        type: DataTypes.INTEGER,
        allowNull: true,
      })
      await query.addIndex('alistamientos', ['wms_alistamiento_id'], {
        unique: true,
        name: 'uq_alistamiento_wms',
      })
      console.log(
        '✅ externalclientes: vínculo de operaciones con WMS agregado.',
      )
    } else
      console.log(
        '✅ externalclientes: vínculo de operaciones existente; sin cambios.',
      )
  } finally {
    await db.close()
  }
}
main().catch(() => {
  console.error(
    'No se completó la migración de operaciones. Revisar database/006-operaciones.sql y conexión local.',
  )
  process.exitCode = 1
})
