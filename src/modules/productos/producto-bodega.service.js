const { fail } = require('../../utils/errors')
const { Op } = require('sequelize')
const { sameProduct } = require('./producto-wms')
const { productView } = require('./producto.presenter')
const {
  fromWms,
  fingerprint,
  normalize,
  matches,
} = require('./producto-similitud')

function createProductoBodegaService({ db, wms, auditoria }) {
  const {
    Producto,
    ProductoVersion,
    ProductoEquivalencia,
    ClienteProducto,
    ComandoIdempotente,
  } = db.models
  const view = (remote) => ({
    codigo_wms: remote.Id_producto,
    ...fromWms(remote),
  })
  const rows = () => wms.products().listProducts()
  async function directory(query) {
    const all = await rows(),
      q = normalize(query.buscar)
    const filtered = all
      .filter(
        (row) =>
          !q ||
          [row.Id_producto, row.Nombre, row.Referencia].some((value) =>
            normalize(value).includes(q),
          ),
      )
      .sort(
        (a, b) =>
          a.Nombre.localeCompare(b.Nombre, 'es') ||
          a.Id_producto.localeCompare(b.Id_producto),
      )
    const page = Number(query.page ?? 1),
      limit = Number(query.limit ?? 25)
    return {
      data: filtered.slice((page - 1) * limit, page * limit).map(view),
      total: filtered.length,
      page,
      limit,
    }
  }
  async function suggestions(input) {
    return {
      data: matches({ tipo: 'Bodega', ...input }, await rows())
        .slice(0, 8)
        .map((row) => ({
          ...view(row.remote),
          exacta: row.exacta,
          similitud: row.similitud,
        })),
    }
  }
  // Una misma ficha puede pertenecer a varias empresas. No se copia stock ni se edita WMS.
  async function attach(transaction, fresh, fields, remote, context) {
    if (remote) {
      const mappings = await ProductoEquivalencia.findAll({
        where: { wms_producto_id: remote.Id_producto },
        transaction,
      })
      const versions = mappings.length
        ? await ProductoVersion.findAll({
            where: {
              id: { [Op.in]: mappings.map((row) => row.producto_version_id) },
            },
            transaction,
          })
        : []
      const blocked =
        versions.length &&
        (await ClienteProducto.findOne({
          where: {
            cliente_id: fresh.cliente_id,
            estado: 'DESHABILITADO',
            producto_id: { [Op.in]: versions.map((row) => row.producto_id) },
          },
          transaction,
        }))
      if (blocked)
        fail(
          409,
          'PRODUCTO_DESHABILITADO',
          'Este producto está deshabilitado para tu empresa.',
        )
    }
    const codigo_maestro = `BOD-${fingerprint(fields)}`
    let product = await Producto.findOne({
      where: { codigo_maestro },
      transaction,
      lock: transaction.LOCK.UPDATE,
    })
    if (!product)
      product = await Producto.create(
        { codigo_maestro, creado_por_actor_id: fresh.actor_id },
        { transaction },
      )
    if (product.estado === 'INACTIVO')
      fail(
        409,
        'PRODUCTO_DESHABILITADO',
        'Esta ficha está deshabilitada. Contacta a Fastway.',
      )
    let version = await ProductoVersion.findOne({
      where: { producto_id: product.id },
      order: [['numero_version', 'DESC']],
      transaction,
      lock: transaction.LOCK.UPDATE,
    })
    if (!version)
      version = await ProductoVersion.create(
        {
          ...fields,
          producto_id: product.id,
          numero_version: 1,
          creado_por_actor_id: fresh.actor_id,
        },
        { transaction },
      )
    if (version.estado === 'RETIRADA')
      fail(
        409,
        'PRODUCTO_DESHABILITADO',
        'Esta ficha está retirada. Contacta a Fastway.',
      )
    if (fingerprint(version) !== fingerprint(fields))
      fail(
        409,
        'PRODUCTO_ACTUALIZADO',
        'La ficha de la maestra cambió. Actualiza el catálogo antes de continuar.',
      )
    const pending = await ComandoIdempotente.findOne({
      where: {
        operacion: 'APROBAR_PRODUCTO_WMS',
        clave: `VERSION-${version.id}`,
      },
      transaction,
      lock: transaction.LOCK.UPDATE,
    })
    const plan =
      pending &&
      (typeof pending.resultado_seguro === 'string'
        ? JSON.parse(pending.resultado_seguro)
        : pending.resultado_seguro)
    if (
      remote &&
      pending?.estado === 'EN_CURSO' &&
      plan?.envio === 'ENVIADO' &&
      (plan.payload.Id_producto !== remote.Id_producto ||
        !sameProduct(version, remote))
    )
      fail(
        409,
        'WMS_CONFIRMACION_PENDIENTE',
        'Primero verifica la creación guardada de esta ficha para evitar duplicados.',
      )
    let equivalence = await ProductoEquivalencia.findOne({
      where: { producto_version_id: version.id },
      transaction,
    })
    if (remote && !equivalence) {
      equivalence = await ProductoEquivalencia.create(
        {
          producto_version_id: version.id,
          wms_producto_id: remote.Id_producto,
          validado_por_actor_id: fresh.actor_id,
          validado_at: new Date(),
        },
        { transaction },
      )
      await version.update(
        {
          estado: 'HOMOLOGADA',
          homologado_por_actor_id: fresh.actor_id,
          homologado_at: new Date(),
        },
        { transaction },
      )
      await product.update({ estado: 'VALIDADO' }, { transaction })
    }
    if (remote && pending?.estado === 'EN_CURSO')
      await pending.update(
        {
          estado: 'COMPLETADO',
          resultado_seguro: {
            envio: 'CONFIRMADO',
            codigo: equivalence.wms_producto_id,
          },
        },
        { transaction },
      )
    let link = await ClienteProducto.findOne({
      where: { cliente_id: fresh.cliente_id, producto_id: product.id },
      transaction,
      lock: transaction.LOCK.UPDATE,
    })
    if (link?.estado === 'DESHABILITADO')
      fail(
        409,
        'PRODUCTO_DESHABILITADO',
        'Este producto está deshabilitado para tu empresa.',
      )
    if (!link)
      link = await ClienteProducto.create(
        {
          cliente_id: fresh.cliente_id,
          producto_id: product.id,
          codigo_cliente: product.codigo_maestro,
          creado_por_actor_id: fresh.actor_id,
          estado: equivalence ? 'HABILITADO' : 'PENDIENTE',
        },
        { transaction },
      )
    else if (equivalence && link.estado !== 'HABILITADO')
      await link.update({ estado: 'HABILITADO' }, { transaction })
    if (link.retirado_at)
      await link.update({ retirado_at: null }, { transaction })
    await auditoria.record(
      transaction,
      context,
      remote ? 'PRODUCTO_BODEGA_REUTILIZADO' : 'PRODUCTO_CLIENTE_CREADO',
      'cliente_producto',
      link.id,
      {
        clientId: fresh.cliente_id,
        actorId: fresh.actor_id,
        sessionId: fresh.sesion_id,
        detail: {
          producto_version_id: String(version.id),
          dispositivo_id: fresh.dispositivo_id,
          codigo_wms: equivalence?.wms_producto_id ?? null,
        },
      },
    )
    return productView(link, version, product, equivalence)
  }
  return { directory, suggestions, attach, rows, matches, fromWms }
}
module.exports = { createProductoBodegaService }
