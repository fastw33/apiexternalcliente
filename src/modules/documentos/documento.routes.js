const { Router, raw } = require('express')
const {
  validateRequest,
  optional,
} = require('../../middlewares/validateRequest.middleware')
const { paginationRules } = require('../../utils/businessValidation')
const rules = require('../../utils/validation')
const { assertWriter } = require('../../utils/customerAccess')
const { fail } = require('../../utils/errors')
const { tipo, formatos } = require('./documento.catalog')
function createDocumentoRoutes({ config, controller, middleware }) {
  const router = Router()
  router.use(middleware.authenticated, middleware.normal)
  router.get(
    '/',
    validateRequest({
      query: {
        ...paginationRules,
        buscar: optional(rules.text('buscar', 250)),
        estado: optional((value) =>
          ['ADJUNTO', 'PENDIENTE'].includes(value)
            ? value
            : fail(
                400,
                'DOCUMENTO_ESTADO_INVALIDO',
                'Selecciona un estado válido.',
              ),
        ),
      },
    }),
    controller.list,
  )
  const params = { tipo }
  router.get(
    '/:tipo/archivo',
    validateRequest({ params, query: {} }),
    controller.file,
  )
  router.post(
    '/:tipo',
    middleware.csrf,
    validateRequest({ params, query: {} }),
    (req, res, next) => {
      try {
        assertWriter(req.customer)
        if (!formatos.some((format) => req.is(format)))
          fail(
            415,
            'DOCUMENTO_FORMATO_INVALIDO',
            'Envía un archivo PDF, JPG o PNG.',
          )
        next()
      } catch (error) {
        next(error)
      }
    },
    raw({
      type: formatos,
      limit: config.documents.maxFileBytes,
      inflate: false,
    }),
    controller.update,
  )
  return router
}
module.exports = { createDocumentoRoutes }
