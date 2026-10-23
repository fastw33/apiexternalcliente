const { fail } = require('./errors')

function assertWriter(auth) {
  if (auth.tipo !== 'NORMAL' || auth.perfil !== 'SOLICITANTE') {
    fail(
      403,
      'PERFIL_SOLICITANTE_REQUERIDO',
      'Esta acción requiere un usuario solicitante de tu empresa.'
    )
  }
}
async function freshWriter(auth, transaction, { sesiones, terminos }) {
  assertWriter(auth)
  const fresh = await sesiones.load(
    auth.token,
    auth.deviceToken,
    transaction,
    true
  )
  assertWriter(fresh)
  const terms = await terminos.status(fresh, transaction)
  if (!terms.disponible)
    fail(
      403,
      'TERMINOS_NO_PUBLICADOS',
      'Los términos del portal están pendientes de publicación.'
    )
  if (!terms.aceptado)
    fail(
      403,
      'TERMINOS_REQUERIDOS',
      'Acepta los términos vigentes antes de operar.'
    )
  return fresh
}
module.exports = { assertWriter, freshWriter }
