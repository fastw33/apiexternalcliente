const { createHash } = require('node:crypto')
const { Op } = require('sequelize')
const catalog = require('../../config/productCatalog')
const { fail, AppError, errorType } = require('../../utils/errors')
const { object } = require('../../middlewares/validateRequest.middleware')
const { productBody, pagination } = require('../../utils/businessValidation')
const { assertWriter, freshWriter } = require('../../utils/customerAccess')
const { productView } = require('./producto.presenter')
const { add } = require('../inventario/inventario.decimal')

function createProductoService({
  db,
  sesiones,
  terminos,
  bodega,
  productosInternos,
  wms,
  logger,
  auditoria,
}) {
  const {
    Producto,
    ProductoVersion,
    ClienteProducto,
    ProductoEquivalencia,
    ComandoIdempotente,
    Cliente,
  } = db.models
  async function list(auth, query) {
    const { page, limit } = pagination(query)
    const { count, rows } = await ClienteProducto.findAndCountAll({
      where: { cliente_id: auth.cliente_id, retirado_at: null },
      include: [
        {
          model: Producto,
          as: 'producto',
          required: true,
          include: [
            {
              model: ProductoVersion,
              as: 'versiones',
              separate: true,
              limit: 1,
              order: [['numero_version', 'DESC']],
            },
          ],
        },
      ],
      order: [['id', 'DESC']],
      limit,
      offset: (page - 1) * limit,
    })
    const versionIds = rows.flatMap((link) =>
      link.producto.versiones.map((version) => version.id),
    )
    const equivalences = versionIds.length
      ? await ProductoEquivalencia.findAll({
          where: { producto_version_id: { [Op.in]: versionIds } },
        })
      : []
    return {
      total: count,
      page,
      limit,
      data: rows.map((link) => {
        const version = link.producto.versiones[0]
        if (!version)
          fail(
            503,
            'CATALOGO_INCOMPLETO',
            'No fue posible consultar una ficha del catálogo. Contacta a Fastway.',
          )
        return productView(
          link,
          version,
          link.producto,
          equivalences.find(
            (item) => String(item.producto_version_id) === String(version.id),
          ),
        )
      }),
    }
  }
  async function retryTransaction(fn) {
    // La clave única de la maestra arbitra dos creaciones idénticas de empresas diferentes.
    for (let attempt = 0; ; attempt++) {
      try {
        return await db.transaction(fn)
      } catch (error) {
        if (
          attempt === 0 &&
          (error.name === 'SequelizeUniqueConstraintError' ||
            error.original?.code === 'ER_LOCK_DEADLOCK')
        )
          continue
        throw error
      }
    }
  }
  async function create(auth, input, context) {
    assertWriter(auth)
    input = object(input, productBody, 'cuerpo')
    if (input.tipo !== 'Bodega')
      fail(
        400,
        'TIPO_NO_PERMITIDO',
        'El catálogo del cliente admite productos tipo Bodega.',
      )
    if (
      catalog.presentaciones.find((item) => item.prefijo === input.prefijo)
        .tipo !== input.tipo
    )
      fail(
        400,
        'PREFIJO_TIPO_INVALIDO',
        'La presentación no corresponde al tipo de producto.',
      )
    const hash = createHash('sha256').update(JSON.stringify(input)).digest()
    const saved = await retryTransaction(async (transaction) => {
      const fresh = await freshWriter(auth, transaction, {
        sesiones,
        terminos,
      })
      const commandWhere = {
        cliente_id: fresh.cliente_id,
        actor_id: fresh.actor_id,
        operacion: 'CREAR_PRODUCTO',
        clave: input.request_id,
      }
      const previous = await ComandoIdempotente.findOne({
        where: commandWhere,
        transaction,
        lock: transaction.LOCK.UPDATE,
      })
      if (previous) {
        if (!Buffer.from(previous.peticion_sha256).equals(hash))
          fail(
            409,
            'CLAVE_REUTILIZADA',
            'El identificador de guardado corresponde a otro contenido.',
          )
        if (previous.estado !== 'COMPLETADO')
          fail(
            409,
            'PRODUCTO_EN_PROCESO',
            'El producto está en proceso. Actualiza tu catálogo antes de reintentar.',
          )
        return typeof previous.resultado_seguro === 'string'
          ? JSON.parse(previous.resultado_seguro)
          : previous.resultado_seguro
      }
      const { request_id, confirmar_diferente, ...fields } = input
      // Repetir la comparación en el servidor al guardar; la comprobación del navegador es orientativa.
      const found = bodega.matches(fields, await bodega.rows())
      const identical = found.find((row) => row.exacta)
      if (!identical && found.length && !confirmar_diferente)
        fail(
          409,
          'PRODUCTOS_SIMILARES',
          'Existen fichas parecidas. Revísalas o confirma que este producto es diferente.',
        )
      const result = await bodega.attach(
        transaction,
        fresh,
        identical ? bodega.fromWms(identical.remote) : fields,
        identical?.remote,
        context,
      )
      await ComandoIdempotente.create(
        {
          ...commandWhere,
          peticion_sha256: hash,
          expira_at: new Date(Date.now() + 86400000),
          estado: 'COMPLETADO',
          resultado_seguro: result,
        },
        { transaction },
      )
      return result
    })
    return confirm(auth, saved.cliente_producto_id, context)
  }
  async function confirm(auth, id, context) {
    assertWriter(auth)
    const link = await ClienteProducto.findOne({
      where: { id, cliente_id: auth.cliente_id },
    })
    if (!link)
      fail(404, 'PRODUCTO_NO_EXISTE', 'El producto no existe en tu catálogo.')
    if (link.retirado_at)
      fail(
        409,
        'PRODUCTO_RETIRADO',
        'El producto fue retirado de tu catálogo. Añádelo nuevamente si deseas usarlo.',
      )
    const version = await ProductoVersion.findOne({
      where: { producto_id: link.producto_id },
      order: [['numero_version', 'DESC']],
    })
    if (!version || version.tipo !== 'Bodega')
      fail(
        409,
        'TIPO_NO_PERMITIDO',
        'Esta operación solo permite productos tipo Bodega.',
      )
    try {
      return await productosInternos.createForCustomer(
        id,
        { producto_version_id: String(version.id) },
        auth,
        context,
      )
    } catch (error) {
      if ([401, 403, 404].includes(error.status)) throw error
      logger?.warn('PRODUCTO_CONFIRMACION_PENDIENTE', {
        correlation_id: context?.correlationId,
        cliente_id: String(auth.cliente_id),
        usuario_id: String(auth.id),
        error_tipo: errorType(error),
        codigo: error instanceof AppError ? error.code : 'ERROR_INTERNO',
      })
      const [product, equivalence] = await Promise.all([
        Producto.findByPk(link.producto_id),
        ProductoEquivalencia.findOne({
          where: { producto_version_id: version.id },
        }),
      ])
      return {
        ...productView(link, version, product, equivalence),
        creacion_error: {
          code:
            error instanceof AppError
              ? error.code
              : 'PRODUCTO_CONFIRMACION_PENDIENTE',
          message:
            error instanceof AppError
              ? error.message
              : 'La ficha está guardada. Verifica su creación en Genika desde Mi catálogo.',
        },
      }
    }
  }
  async function useExisting(auth, id, context) {
    assertWriter(auth)
    const remote = await wms.products().getProduct(id)
    if (!remote)
      fail(404, 'PRODUCTO_NO_EXISTE', 'El producto Bodega no existe.')
    const fields = bodega.fromWms(remote)
    if (
      !catalog.unidades.includes(fields.unidad_medida) ||
      ['alto_cm', 'ancho_cm', 'largo_cm'].some(
        (key) =>
          Number(fields[key]) >= 1e10 ||
          Number(fields[key]) !== Number(Number(fields[key]).toFixed(4)),
      )
    )
      fail(
        409,
        'FICHA_NO_COMPATIBLE',
        'La unidad o dimensiones de esta ficha requieren revisión de Fastway.',
      )
    return retryTransaction(async (transaction) => {
      const fresh = await freshWriter(auth, transaction, {
        sesiones,
        terminos,
      })
      return bodega.attach(transaction, fresh, fields, remote, context)
    })
  }
  async function remove(auth, id, context) {
    assertWriter(auth)
    return db.transaction(async (transaction) => {
      const fresh = await freshWriter(auth, transaction, { sesiones, terminos })
      const link = await ClienteProducto.findOne({
        where: { id, cliente_id: fresh.cliente_id },
        transaction,
        lock: transaction.LOCK.UPDATE,
      })
      if (!link)
        fail(404, 'PRODUCTO_NO_EXISTE', 'El producto no existe en tu catálogo.')
      if (link.retirado_at)
        return { cliente_producto_id: String(link.id), retirado: true }
      const versions = await ProductoVersion.findAll({
        where: { producto_id: link.producto_id },
        transaction,
      })
      const mappings = versions.length
        ? await ProductoEquivalencia.findAll({
            where: {
              producto_version_id: { [Op.in]: versions.map((row) => row.id) },
            },
            transaction,
          })
        : []
      const codes = new Set(mappings.map((row) => row.wms_producto_id))
      const commands = versions.length
        ? await ComandoIdempotente.findAll({
            where: {
              operacion: 'APROBAR_PRODUCTO_WMS',
              clave: { [Op.in]: versions.map((row) => `VERSION-${row.id}`) },
              estado: 'EN_CURSO',
            },
            transaction,
          })
        : []
      for (const command of commands) {
        const plan =
          typeof command.resultado_seguro === 'string'
            ? JSON.parse(command.resultado_seguro)
            : command.resultado_seguro
        if (plan?.envio === 'ENVIADO' && plan.payload?.Id_producto)
          codes.add(plan.payload.Id_producto)
      }
      const client = await Cliente.findByPk(fresh.cliente_id, { transaction })
      // Consulta completa del cliente: nunca usar la página o el buscador del navegador como comprobación.
      const stock = await wms.inventory(client.wms_cliente_id)
      if (
        stock.some(
          (row) => codes.has(row.producto_id) && add('0', row.cantidad) !== '0',
        )
      )
        fail(
          409,
          'PRODUCTO_CON_EXISTENCIAS',
          'No puedes quitar este producto de tu catálogo porque tiene existencias en tu inventario.',
        )
      await link.update({ retirado_at: new Date() }, { transaction })
      await auditoria.record(
        transaction,
        context,
        'PRODUCTO_RETIRADO_CATALOGO',
        'cliente_producto',
        link.id,
        {
          clientId: fresh.cliente_id,
          actorId: fresh.actor_id,
          sessionId: fresh.sesion_id,
          detail: {
            producto_id: String(link.producto_id),
            codigos_wms: [...codes],
            dispositivo_id: fresh.dispositivo_id,
          },
        },
      )
      return { cliente_producto_id: String(link.id), retirado: true }
    })
  }
  return {
    list,
    create,
    confirm,
    useExisting,
    remove,
    directory: bodega.directory,
    suggestions: bodega.suggestions,
    catalog: () => ({
      ...catalog,
      tipos: ['Bodega'],
      presentaciones: catalog.presentaciones.filter(
        (item) => item.tipo === 'Bodega',
      ),
    }),
  }
}
module.exports = { createProductoService }
