const { add } = require('../inventario/inventario.decimal')
const { fail } = require('../../utils/errors')
const { Op } = require('sequelize')
const key = (product, lot) => JSON.stringify([product, lot])

// Presencia actual de los productos declarados en el inventario del mismo cliente y lote.
function receptionProjection(lines, stocks, lot) {
  const totals = new Map(),
    units = new Map(),
    seen = new Set()
  if (
    !lines.length ||
    lines.some((line) => !line.codigo_wms) ||
    !Array.isArray(stocks)
  )
    fail(
      502,
      'INVENTARIO_RECEPCION_INVALIDO',
      'No se pudo verificar el inventario del lote.',
    )
  const expected = new Set(lines.map((line) => line.codigo_wms))
  const lotStocks = stocks.filter((stock) => stock.lote_id === lot)
  // Igual que Genika: sin registros es nuevo; registros existentes en cero indican lote cerrado.
  const closed =
    lotStocks.length > 0 &&
    lotStocks.every((stock) => add('0', stock.cantidad) === '0')
  for (const stock of stocks) {
    if (stock.lote_id !== lot || !expected.has(stock.producto_id)) continue
    if (stock.inventario_id == null || seen.has(String(stock.inventario_id)))
      fail(
        502,
        'INVENTARIO_RECEPCION_INVALIDO',
        'No se pudo verificar el inventario del lote.',
      )
    seen.add(String(stock.inventario_id))
    const id = key(stock.producto_id, lot)
    if (units.has(id) && units.get(id) !== stock.unidad_medida)
      fail(
        502,
        'UNIDAD_RECEPCION_INVALIDA',
        'La unidad de recepción no coincide.',
      )
    units.set(id, stock.unidad_medida)
    totals.set(id, add(totals.get(id) || '0', stock.cantidad))
  }
  // Dos referencias externas pueden apuntar a la misma ficha WMS. No atribuir dos veces un ingreso.
  const frequency = new Map()
  for (const line of lines)
    if (line.codigo_wms)
      frequency.set(line.codigo_wms, (frequency.get(line.codigo_wms) || 0) + 1)
  const present = (quantity) => quantity !== '0' && !quantity.startsWith('-')
  const productsPresent = [...expected].filter((code) =>
    present(totals.get(key(code, lot)) || '0'),
  ).length
  const details = lines.map((line) => {
    const id = key(line.codigo_wms, lot)
    const quantity = totals.get(id) || '0'
    const shared = frequency.get(line.codigo_wms) > 1 && present(quantity)
    return {
      ...line,
      cantidad_en_inventario: shared ? null : quantity,
      cantidad_recibida: shared ? null : quantity,
      inventario_compartido: shared,
      unidad_inventario: units.get(id) || line.unidad_medida,
      recepcion_estado: present(quantity) ? 'RECIBIDO' : 'PENDIENTE',
    }
  })
  return {
    detalles: details,
    recepcion: {
      estado: closed
        ? 'CERRADA'
        : productsPresent === 0
          ? 'PENDIENTE'
          : productsPresent < expected.size
            ? 'PARCIAL'
            : 'RECIBIDA',
      fuente: 'INVENTARIO_ACTUAL',
      total_productos: expected.size,
      productos_en_inventario: productsPresent,
      consultado_at: new Date().toISOString(),
    },
  }
}

function createPrecargaRecepcionService({ db, wms }) {
  async function enrichList(requests, summaries) {
    const pending = requests.filter(
      (row, index) => summaries[index].wms_lote_id,
    )
    if (!pending.length)
      return summaries.map((row) => ({
        ...row,
        recepcion: { estado: 'SIN_LOTE' },
      }))
    const { SolicitudRevision, ProductoEquivalencia, Cliente } = db.models
    const [revisions, clients] = await Promise.all([
      SolicitudRevision.findAll({
        where: {
          [Op.or]: pending.map((row) => ({
            cliente_id: row.cliente_id,
            solicitud_id: row.id,
            numero_revision: row.revision_actual,
          })),
        },
      }),
      Cliente.findAll({
        where: {
          id: { [Op.in]: [...new Set(pending.map((row) => row.cliente_id))] },
        },
        attributes: ['id', 'wms_cliente_id'],
      }),
    ])
    const snapshots = new Map(
      revisions.map((row) => [
        String(row.solicitud_id),
        typeof row.contenido === 'string'
          ? JSON.parse(row.contenido)
          : row.contenido,
      ]),
    )
    const versionIds = [
      ...new Set(
        [...snapshots.values()].flatMap((row) =>
          Array.isArray(row?.detalles)
            ? row.detalles.map((line) => line.producto_version_id)
            : [],
        ),
      ),
    ]
    const equivalents = versionIds.length
      ? await ProductoEquivalencia.findAll({
          where: { producto_version_id: { [Op.in]: versionIds } },
          attributes: ['producto_version_id', 'wms_producto_id'],
        })
      : []
    const codes = new Map(
      equivalents.map((row) => [
        String(row.producto_version_id),
        row.wms_producto_id,
      ]),
    )
    const stocks = new Map()
    await Promise.all(
      clients.map(async (client) => {
        try {
          stocks.set(
            String(client.id),
            await wms.inventory(client.wms_cliente_id),
          )
        } catch {
          stocks.set(String(client.id), null)
        }
      }),
    )
    return summaries.map((row, index) => {
      if (!row.wms_lote_id) return { ...row, recepcion: { estado: 'SIN_LOTE' } }
      try {
        const request = requests[index],
          snapshot = snapshots.get(String(request.id))
        const entries = stocks.get(String(request.cliente_id))
        if (!snapshot?.detalles?.length || !Array.isArray(entries))
          throw new Error('Recepción no disponible')
        const lines = snapshot.detalles.map((line) => ({
          ...line,
          codigo_wms: codes.get(String(line.producto_version_id)) || null,
        }))
        const { recepcion } = receptionProjection(
          lines,
          entries,
          row.wms_lote_id,
        )
        return { ...row, recepcion }
      } catch {
        return { ...row, recepcion: { estado: 'NO_DISPONIBLE' } }
      }
    })
  }
  async function enrich(detail, clientId, cachedInventory = undefined) {
    if (!detail.wms_lote_id)
      return { ...detail, recepcion: { estado: 'SIN_LOTE' } }
    try {
      const client = await db.models.Cliente.findByPk(clientId)
      if (!client) fail(404, 'CLIENTE_NO_EXISTE', 'Cliente no disponible.')
      const stocks =
        cachedInventory === undefined
          ? await wms.inventory(client.wms_cliente_id)
          : cachedInventory
      return {
        ...detail,
        ...receptionProjection(detail.detalles, stocks, detail.wms_lote_id),
      }
    } catch {
      return {
        ...detail,
        recepcion: {
          estado: 'NO_DISPONIBLE',
          mensaje:
            'No se pudo consultar la recepción en Genika. Actualiza para verificarla.',
        },
      }
    }
  }
  return { enrich, enrichList }
}
module.exports = { createPrecargaRecepcionService, receptionProjection }
