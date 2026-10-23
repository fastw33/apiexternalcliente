const fields = [
  ['nombre', 'Nombre'],
  ['referencia', 'Referencia'],
  ['tipo', 'Tipo'],
  ['unidad_medida', 'Unidad_de_medida'],
  ['alto_cm', 'Alto'],
  ['ancho_cm', 'Ancho'],
  ['largo_cm', 'Largo'],
]
function sameProduct(version, remote) {
  if (!remote) return false
  if (version.prefijo) {
    const code = String(remote.Id_producto)
    if (
      !code.startsWith(version.prefijo) ||
      !/^\d+$/.test(code.slice(version.prefijo.length))
    )
      return false
  }
  return fields.every(([local, external]) =>
    local.endsWith('_cm')
      ? Number.isFinite(Number(remote[external])) &&
        Number(version[local]) === Number(remote[external])
      : String(version[local]).trim() === String(remote[external]).trim()
  )
}
function productPayload(version, code) {
  return {
    Id_producto: code,
    Nombre: version.nombre,
    Referencia: version.referencia,
    Tipo: version.tipo,
    Unidad_de_medida: version.unidad_medida,
    Alto: Number(version.alto_cm),
    Ancho: Number(version.ancho_cm),
    Largo: Number(version.largo_cm),
  }
}
function nextCode(prefix, products) {
  let maximum = 0n
  for (const product of products) {
    const id = product.Id_producto
    if (!id.startsWith(prefix)) continue
    const suffix = id.slice(prefix.length)
    if (/^\d+$/.test(suffix) && BigInt(suffix) > maximum)
      maximum = BigInt(suffix)
  }
  return prefix + String(maximum + 1n).padStart(3, '0')
}
module.exports = { sameProduct, productPayload, nextCode }
