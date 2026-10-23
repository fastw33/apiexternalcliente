const { fail } = require('../../utils/errors')
function parse(value) {
  const match = /^(-?)(\d{1,320})(?:\.(\d{1,324}))?(?:e([+-]?\d{1,3}))?$/i.exec(
    String(value),
  )
  if (
    !match ||
    !Number.isFinite(Number(value)) ||
    Math.abs(Number(match[4] || 0)) > 324
  )
    fail(
      502,
      'CANTIDAD_INVENTARIO_INVALIDA',
      'WMS devolvió una cantidad de inventario inválida.',
    )
  let scale = (match[3] || '').length - Number(match[4] || 0)
  let coefficient = BigInt((match[1] || '') + match[2] + (match[3] || ''))
  if (scale < 0) {
    coefficient *= 10n ** BigInt(-scale)
    scale = 0
  }
  return { coefficient, scale }
}
function add(left, right) {
  const a = parse(left),
    b = parse(right),
    scale = Math.max(a.scale, b.scale)
  const sum =
    a.coefficient * 10n ** BigInt(scale - a.scale) +
    b.coefficient * 10n ** BigInt(scale - b.scale)
  const digits = (sum < 0n ? -sum : sum).toString().padStart(scale + 1, '0')
  const formatted = scale
    ? (digits.slice(0, -scale) + '.' + digits.slice(-scale))
        .replace(/0+$/, '')
        .replace(/\.$/, '')
    : digits
  return (sum < 0n ? '-' : '') + formatted
}
function compare(left, right) {
  const a = parse(left),
    b = parse(right),
    scale = Math.max(a.scale, b.scale)
  const first = a.coefficient * 10n ** BigInt(scale - a.scale)
  const second = b.coefficient * 10n ** BigInt(scale - b.scale)
  return first < second ? -1 : first > second ? 1 : 0
}
module.exports = { add, compare }
