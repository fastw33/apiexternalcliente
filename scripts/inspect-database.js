const { QueryTypes } = require('sequelize')
const { AppError } = require('../src/utils/errors')

async function inspectDatabase(sequelize) {
    await sequelize.authenticate()
    const [server] = await sequelize.query('SELECT DATABASE() AS name, VERSION() AS version',{type:QueryTypes.SELECT})
    const columns = await sequelize.query(`SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ?`,{replacements:[sequelize.getDatabaseName()],type:QueryTypes.SELECT})
    const missing = Object.values(sequelize.models).some(model=>Object.keys(model.rawAttributes).some(name=>
      !columns.some(column=>column.TABLE_NAME===model.tableName && column.COLUMN_NAME===name)))
    if (server.name !== sequelize.getDatabaseName() || missing) {
      throw new AppError(503,'ESQUEMA_INCOMPLETO','Faltan tablas o columnas del esquema externalclientes. Ejecutar npm run db:check.')
    }
    const [counts] = await sequelize.query(`SELECT
      (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE') AS tables_count,
      (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = ?) AS foreign_keys_count`,
    {replacements:[sequelize.getDatabaseName(),sequelize.getDatabaseName()],type:QueryTypes.SELECT})
    return {database:server.name,version:server.version,tables:Number(counts.tables_count),foreign_keys:Number(counts.foreign_keys_count)}
  }
module.exports = { inspectDatabase }
