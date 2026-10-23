const { createConnection } = require('../src/config/db')
const { initializeModels } = require('../src/models')
const { inspectDatabase } = require('./inspect-database')

async function main() {
  const db = createConnection()
  initializeModels(db)
  try {
    console.log(JSON.stringify(await inspectDatabase(db),null,2))
  } catch (error) {
    console.error(JSON.stringify({ code:error.code || 'DB_NO_DISPONIBLE',
      message:error.status ? error.message : 'Revisar conexión y esquema en .env; no se modificó la base.' }))
    process.exitCode = 1
  } finally { await db.close() }
}
main().catch(()=>{ console.error('No fue posible validar la configuración.');process.exitCode=1 })
