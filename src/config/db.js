const { Sequelize } = require('sequelize')
const config = require('./env')

function createConnection(options = config.db) {
  return new Sequelize(options.database, options.user, options.password, {
    host: options.host,
    port: options.port,
    dialect: 'mysql',
    timezone: '+00:00',
    logging: false,
    pool: { max: options.connectionLimit, min: 0 },
    dialectOptions: { charset: 'utf8mb4_unicode_ci', supportBigNumbers: true, bigNumberStrings: true },
  })
}

module.exports = { createConnection }
