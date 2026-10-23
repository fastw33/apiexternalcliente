const { Router } = require('express')
const {
  validateRequest,
  optional,
} = require('../../middlewares/validateRequest.middleware')
const rules = require('../../utils/validation')
const { fail } = require('../../utils/errors')
function createProductoInternoRoutes(controller) {
  const router = Router()
  router.get(
    '/',
    validateRequest({
      query: {
        page: optional(rules.page),
        limit: optional(rules.limit),
        cliente_id: optional(rules.id),
        estado: optional(value =>
          ['PENDIENTE', 'HABILITADO', 'DESHABILITADO', 'TODOS'].includes(value)
            ? value
            : fail(400, 'ESTADO_INVALIDO', 'Estado de producto inválido.')
        ),
      },
    }),
    controller.list
  )
  router.get(
    '/wms',
    validateRequest({
      query: {
        buscar: optional(rules.text('buscar', 100)),
        prefijo: optional(rules.text('prefijo', 80)),
      },
    }),
    controller.search
  )
  router.post(
    '/:id/aprobar',
    validateRequest({
      query: {},
      params: { id: rules.id },
      body: {
        producto_version_id: rules.id,
        modo: value =>
          ['CREAR', 'VINCULAR'].includes(value)
            ? value
            : fail(400, 'MODO_INVALIDO', 'Selecciona crear o vincular.'),
        wms_producto_id: optional(rules.text('wms_producto_id', 250)),
      },
    }),
    controller.approve
  )
  return router
}
module.exports = { createProductoInternoRoutes }
