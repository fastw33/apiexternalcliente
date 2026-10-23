const { Router } = require('express')
const {
  validateRequest,
  optional,
} = require('../../middlewares/validateRequest.middleware')
const rules = require('../../utils/validation')
const { paginationRules } = require('../../utils/businessValidation')
const { fail } = require('../../utils/errors')
const publicId = (value) =>
  typeof value === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
    value,
  )
    ? value
    : fail(400, 'ID_PRECARGA_INVALIDO', 'Identificador de precarga inválido.')
const revision = (value) =>
  Number.isInteger(value) && value > 0 && value <= 4294967295
    ? value
    : fail(400, 'REVISION_INVALIDA', 'La revisión esperada no es válida.')
function createPrecargaInternoRoutes(controller) {
  const router = Router()
  router.get(
    '/',
    validateRequest({
      query: {
        ...paginationRules,
        cliente_id: optional(rules.id),
        estado: optional((value) =>
          [
            'TODOS',
            'BORRADOR',
            'ENVIADA',
            'OBSERVADA',
            'APROBADA',
            'RECHAZADA',
            'CANCELACION_SOLICITADA',
            'CANCELADA',
            'CERRADA',
          ].includes(value)
            ? value
            : fail(400, 'ESTADO_INVALIDO', 'Estado de precarga inválido.'),
        ),
      },
    }),
    controller.list,
  )
  router.get(
    '/:public_id',
    validateRequest({ query: {}, params: { public_id: publicId } }),
    controller.detail,
  )
  router.post(
    '/:public_id/crear-lote',
    validateRequest({
      query: {},
      params: { public_id: publicId },
      body: {
        revision,
      },
    }),
    controller.createLot,
  )
  return router
}
module.exports = { createPrecargaInternoRoutes, publicId, revision }
