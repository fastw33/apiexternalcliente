const { optional } = require('../../middlewares/validateRequest.middleware')
const { paginationRules } = require('../../utils/businessValidation')
const rules = require('../../utils/validation')
const { fail } = require('../../utils/errors')
const choice = (values) => (value) => {
  if (!values.includes(value))
    fail(400, 'DATOS_INVALIDOS', 'El filtro de inventario no es válido.')
  return value
}
const productQuery = {
  ...paginationRules,
  buscar: optional(rules.text('buscar', 250)),
  campo: optional(
    choice(['todos', 'producto', 'codigo', 'referencia', 'lote']),
  ),
  unidad: optional(rules.text('unidad', 50)),
  lotes: optional(choice(['todos', 'uno', 'varios'])),
  ordenar: optional(
    choice(['nombre', 'cantidad_desc', 'cantidad_asc', 'reciente']),
  ),
}
const lotsQuery = {
  ...paginationRules,
  unidad: rules.text('unidad', 50),
  buscar: optional(rules.text('buscar', 250)),
}
module.exports = { productQuery, lotsQuery }
