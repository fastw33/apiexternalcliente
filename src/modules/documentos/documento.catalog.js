const catalog = {
  rut: 'RUT',
  camara_comercio: 'Cámara de Comercio',
  certificacion_bancaria: 'Certificación bancaria',
  cedula: 'Cédula',
  certificacion_comercial: 'Certificación comercial',
  estados_financieros: 'Estados financieros',
  certificado_contadora: 'Certificación contable',
  acuerdo_seguridad: 'Acuerdo de seguridad',
  circular_170: 'Circular 170',
  tratamiento_datos_personales: 'Tratamiento de datos personales',
}
const { fail } = require('../../utils/errors')
const tipo = (value) =>
  Object.hasOwn(catalog, value)
    ? value
    : fail(
        400,
        'DOCUMENTO_TIPO_INVALIDO',
        'El tipo de documento no está habilitado para el portal.',
      )
function fileType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8)
    fail(
      415,
      'DOCUMENTO_FORMATO_INVALIDO',
      'El archivo debe ser un PDF, JPG o PNG válido.',
    )
  if (/^%PDF-(1\.[0-9]|2\.0)/.test(buffer.subarray(0, 8).toString('ascii')))
    return { mime: 'application/pdf', extension: 'pdf' }
  if (
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return { mime: 'image/png', extension: 'png' }
  if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255)
    return { mime: 'image/jpeg', extension: 'jpg' }
  fail(
    415,
    'DOCUMENTO_FORMATO_INVALIDO',
    'El archivo debe ser un PDF, JPG o PNG válido.',
  )
}
const formatos = ['application/pdf', 'image/jpeg', 'image/png']
module.exports = { catalog, tipo, fileType, formatos }
