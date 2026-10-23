const { DataTypes } = require('sequelize')
const { createConnection } = require('../src/config/db')
async function main() {
  const db = createConnection()
  try {
    if (db.getDatabaseName() !== 'externalclientes') throw new Error('Base inesperada')
    const query = db.getQueryInterface()
    const columns = await query.describeTable('producto_versiones')
    if (!columns.prefijo) {
      await query.addColumn('producto_versiones','prefijo',{type:DataTypes.STRING(80),allowNull:true})
      console.log('✅ Columna prefijo agregada. Productos existentes conservados.')
    } else console.log('✅ La columna prefijo ya existe; sin cambios.')
  } finally { await db.close() }
}
main().catch(()=>{console.error('No se pudo actualizar producto_versiones. Revisa la conexión y el esquema.');process.exitCode=1})
