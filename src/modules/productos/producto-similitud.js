const { createHash } = require('node:crypto')
const normalize = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('es')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
const fromWms = (row) => ({
  nombre: row.Nombre,
  referencia: row.Referencia,
  tipo: row.Tipo,
  unidad_medida: row.Unidad_de_medida,
  alto_cm: String(row.Alto),
  ancho_cm: String(row.Ancho),
  largo_cm: String(row.Largo),
  prefijo: /^([A-Z_]+)\d+$/.exec(row.Id_producto)?.[1] ?? null,
})
function fingerprint(row) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        normalize(row.nombre),
        normalize(row.referencia),
        normalize(row.tipo),
        normalize(row.unidad_medida),
        ...['alto_cm', 'ancho_cm', 'largo_cm'].map((key) => Number(row[key])),
        row.prefijo ?? null,
      ]),
    )
    .digest('hex')
}
function similarity(a, b) {
  a = normalize(a)
  b = normalize(b)
  if (!a || !b) return 0
  if (a === b) return 1
  if (Math.min(a.length, b.length) < 3) return 0
  const pairs = (value) => {
    const out = new Map()
    for (let i = 0; i < value.length - 1; i++) {
      const part = value.slice(i, i + 2)
      out.set(part, (out.get(part) || 0) + 1)
    }
    return out
  }
  const left = pairs(a),
    right = pairs(b)
  let shared = 0
  for (const [part, count] of left)
    shared += Math.min(count, right.get(part) || 0)
  return (2 * shared) / (a.length + b.length - 2)
}
function matches(input, rows) {
  return rows
    .map((remote) => {
      const fields = fromWms(remote)
      const exacta =
        [
          'nombre',
          'referencia',
          'unidad_medida',
          'alto_cm',
          'ancho_cm',
          'largo_cm',
          'prefijo',
        ].every((key) => input[key] !== undefined && input[key] !== '') &&
        fingerprint(input) === fingerprint(fields)
      const nombre = similarity(input.nombre, fields.nombre),
        referencia = similarity(input.referencia, fields.referencia)
      return {
        remote,
        exacta,
        similitud: Math.round(Math.max(nombre, referencia) * 100),
      }
    })
    .filter((row) => row.exacta || row.similitud >= 60)
    .sort(
      (a, b) =>
        Number(b.exacta) - Number(a.exacta) ||
        b.similitud - a.similitud ||
        a.remote.Id_producto.localeCompare(b.remote.Id_producto),
    )
}
module.exports = { normalize, fromWms, fingerprint, similarity, matches }
