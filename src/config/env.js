const path = require('node:path')

const root = path.resolve(__dirname, '../..')
require('dotenv').config({ path: path.join(root, '.env') })

module.exports = {
  root,
  nodeEnv: process.env.NODE_ENV,
  host: process.env.HOST,
  port: Number(process.env.PORT),
  publicUrl: process.env.PUBLIC_BASE_URL,
  trustProxy: Number(process.env.TRUST_PROXY_HOPS),
  logLevel: process.env.LOG_LEVEL,
  operations: {
    changesEnabled: process.env.OPERACION_CAMBIOS_HABILITADOS === 'true',
    leadMinutes: Number(process.env.OPERACION_ANTICIPACION_MINUTOS),
    openingTime: process.env.OPERACION_HORA_INICIO,
    closingTime: process.env.OPERACION_HORA_FIN,
    bodyLimitBytes: Number(process.env.OPERACION_HTTP_BODY_LIMIT_BYTES),
    maxKeys: Number(process.env.OPERACION_HTTP_JSON_MAX_KEYS),
  },
  documents: {
    maxFileBytes: Number(process.env.DOCUMENTOS_MAX_ARCHIVO_BYTES),
  },
  http: {
    bodyLimitBytes: Number(process.env.HTTP_BODY_LIMIT_BYTES),
    maxUrlLength: Number(process.env.HTTP_MAX_URL_LENGTH),
    maxDepth: Number(process.env.HTTP_JSON_MAX_DEPTH),
    maxKeys: Number(process.env.HTTP_JSON_MAX_KEYS),
    maxQueryKeys: Number(process.env.HTTP_QUERY_MAX_KEYS),
    headersTimeoutMs: Number(process.env.HTTP_HEADERS_TIMEOUT_MS),
    requestTimeoutMs: Number(process.env.HTTP_REQUEST_TIMEOUT_MS),
    socketTimeoutMs: Number(process.env.HTTP_SOCKET_TIMEOUT_MS),
    keepAliveTimeoutMs: Number(process.env.HTTP_KEEP_ALIVE_TIMEOUT_MS),
    maxHeaderBytes: Number(process.env.HTTP_MAX_HEADER_BYTES),
    maxRequestsPerSocket: Number(process.env.HTTP_MAX_REQUESTS_PER_SOCKET),
  },
  origins: [process.env.PUBLIC_BASE_URL, ...process.env.CORS_ALLOWED_ORIGINS.split(',').map(origin => origin.trim())],
  db: {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectionLimit: Number(process.env.DB_POOL_SIZE),
  },
  wms: {
    baseUrl: process.env.WMS_BASE_URL,
    jwtSecret: process.env.WMS_JWT_SECRET,
    internalServiceKey: process.env.WMS_INTERNAL_SERVICE_KEY,
    timeoutMs: Number(process.env.WMS_TIMEOUT_MS),
    maxResponseBytes: Number(process.env.WMS_RESPONSE_MAX_BYTES),
  },
  cookie: {
    sessionName: process.env.SESSION_COOKIE_NAME,
    deviceName: process.env.DEVICE_COOKIE_NAME,
    secure: process.env.COOKIE_SECURE === 'true',
    sameSite: process.env.COOKIE_SAME_SITE,
  },
  session: {
    hashSecret: process.env.SESSION_HASH_SECRET,
    csrfSecret: process.env.CSRF_SECRET,
    ttlMinutes: Number(process.env.SESSION_TTL_MINUTES),
    idleMinutes: Number(process.env.SESSION_IDLE_MINUTES),
    provisionalMinutes: Number(process.env.PROVISIONAL_SESSION_MINUTES),
    deviceDays: Number(process.env.DEVICE_COOKIE_DAYS),
  },
  password: {
    maxConcurrent: Number(process.env.AUTH_MAX_CONCURRENT_HASHES),
    pepper: process.env.PASSWORD_PEPPER,
    N: Number(process.env.PASSWORD_SCRYPT_N),
    p: Number(process.env.PASSWORD_SCRYPT_P),
    minLength: Number(process.env.PASSWORD_MIN_LENGTH),
    maxLength: Number(process.env.PASSWORD_MAX_LENGTH),
    temporaryMinutes: Number(process.env.TEMPORARY_PASSWORD_MINUTES),
  },
  rate: {
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS),
    max: Number(process.env.RATE_LIMIT_MAX),
    loginMax: Number(process.env.LOGIN_RATE_LIMIT_MAX),
    accountFailures: Number(process.env.LOGIN_ACCOUNT_MAX_FAILURES),
    lockMinutes: Number(process.env.LOGIN_ACCOUNT_LOCK_MINUTES),
  },
}
