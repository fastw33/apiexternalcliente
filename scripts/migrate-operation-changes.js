const fs = require('node:fs')
const path = require('node:path')
const { createConnection } = require('../src/config/db')
async function main() {
  const db = createConnection()
  try {
    if (db.getDatabaseName() !== 'externalclientes')
      throw new Error('Base inesperada')
    await db.query(
      fs.readFileSync(
        path.join(__dirname, '../database/007-cambios-operacion.sql'),
        'utf8',
      ),
    )
    console.log(
      '✅ externalclientes: solicitudes de cambio habilitadas. WMS no fue modificado.',
    )
  } finally {
    await db.close()
  }
}
main().catch(() => {
  console.error('No se completó database/007-cambios-operacion.sql.')
  process.exitCode = 1
})
