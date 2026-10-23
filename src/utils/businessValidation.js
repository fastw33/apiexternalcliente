const { fail } = require('./errors')
const rules = require('./validation')
const catalog = require('../config/productCatalog')
const {
  object,
  optional,
} = require('../middlewares/validateRequest.middleware')

const invalid = () =>
  fail(
    400,
    'DATOS_INVALIDOS',
    'Revisa el formato de los datos de la operación.',
  )
const decimal =
  (integers, places, positive = false) =>
  (value) => {
    if (
      typeof value !== 'string' ||
      !new RegExp(
        `^(0|[1-9][0-9]{0,${integers - 1}})(\\.[0-9]{1,${places}})?$`,
      ).test(value) ||
      (positive && !/[1-9]/.test(value))
    )
      invalid()
    return value
  }
const nullableText = (max) => (value) =>
  value === null ? null : rules.text('referencia', max)(value)
const notes = (value) => {
  if (value === null) return null
  if (
    typeof value !== 'string' ||
    value.length > 1000 ||
    !value.trim() ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value) ||
    Buffer.from(value, 'utf8').toString('utf8') !== value
  )
    invalid()
  return value.trim()
}
const uuid = (value) => {
  if (
    typeof value !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      value,
    )
  )
    invalid()
  return value
}
const productBody = {
  confirmar_diferente: optional(rules.boolean),
  request_id: uuid,
  prefijo: (value) =>
    catalog.presentaciones.some((item) => item.prefijo === value)
      ? value
      : invalid(),
  nombre: rules.text('nombre', 250),
  referencia: rules.text('referencia', 250),
  tipo: (value) => (catalog.tipos.includes(value) ? value : invalid()),
  unidad_medida: (value) =>
    catalog.unidades.includes(value) ? value : invalid(),
  alto_cm: decimal(10, 4),
  ancho_cm: decimal(10, 4),
  largo_cm: decimal(10, 4),
}
const details = (value) => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 25) invalid()
  const ids = new Set()
  return value.map((line) => {
    const clean = object(
      line,
      {
        cliente_producto_id: rules.id,
        producto_version_id: rules.id,
        cantidad_declarada: decimal(14, 6, true),
      },
      'productos',
    )
    if (ids.has(clean.cliente_producto_id))
      fail(400, 'PRODUCTO_REPETIDO', 'Incluye cada producto una sola vez.')
    ids.add(clean.cliente_producto_id)
    return clean
  })
}
const preloadBody = {
  request_id: uuid,
  fecha_programada_at: (value) => {
    if (
      typeof value !== 'string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:00-05:00$/.test(value) ||
      !Number.isFinite(+new Date(value)) ||
      new Date(+new Date(value) - 5 * 3600000).toISOString().slice(0, 19) !==
        value.slice(0, 19)
    )
      invalid()
    return value
  },
  referencia_lote: rules.text('referencia_lote', 120),
  referencia_contenedor: nullableText(120),
  referencia_transporte: nullableText(120),
  observacion: notes,
  detalles: details,
}
const paginationRules = {
  page: optional(rules.page),
  limit: optional(rules.limit),
}
function pagination(query = {}) {
  // Las reglas de consulta admiten texto HTTP; aquí también se validan llamadas internas.
  const validated = object(query, paginationRules, 'consulta')
  return { page: validated.page ?? 1, limit: validated.limit ?? 25 }
}
module.exports = {
  decimal,
  productBody,
  preloadBody,
  paginationRules,
  pagination,
}
