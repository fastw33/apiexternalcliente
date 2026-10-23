const { Op } = require('sequelize')
const { freshWriter } = require('../../utils/customerAccess')
const { createHash } = require('node:crypto')
const { fail } = require('../../utils/errors')
const { isoDate, bool } = require('../../utils/security')
const { productView } = require('./producto.presenter')
const { sameProduct, productPayload, nextCode } = require('./producto-wms')
const { matches } = require('./producto-similitud')
const parse = (value) => (typeof value === 'string' ? JSON.parse(value) : value)
const operation = 'APROBAR_PRODUCTO_WMS'

function createProductoInternoService({
  db,
  wms,
  actores,
  auditoria,
  sesiones,
  terminos,
}) {
  const {
    Cliente,
    ClienteProducto,
    Producto,
    ProductoVersion,
    ProductoEquivalencia,
    ComandoIdempotente,
    Actor,
  } = db.models
  async function load(id, transaction, lock = false, customer = null) {
    const options = {
      transaction,
      ...(lock ? { lock: transaction.LOCK.UPDATE } : {}),
    }
    const link = await ClienteProducto.findOne({
      where: { id, ...(customer ? { cliente_id: customer.cliente_id } : {}) },
      ...options,
    })
    if (!link)
      fail(404, 'PRODUCTO_NO_EXISTE', 'El producto del cliente no existe.')
    const product = await Producto.findByPk(link.producto_id, options)
    const version = await ProductoVersion.findOne({
      where: { producto_id: link.producto_id },
      order: [['numero_version', 'DESC']],
      ...options,
    })
    const client = await Cliente.findByPk(link.cliente_id, options)
    if (!product || !version || !client)
      fail(409, 'FICHA_INCOMPLETA', 'La ficha del producto está incompleta.')
    return { link, product, version, client }
  }
  function check(ficha, input) {
    if (ficha.link.retirado_at)
      fail(
        409,
        'PRODUCTO_RETIRADO',
        'Este producto fue retirado del catálogo del cliente.',
      )
    if (String(ficha.version.id) !== input.producto_version_id)
      fail(
        409,
        'PRODUCTO_ACTUALIZADO',
        'La ficha cambió. Actualiza la bandeja antes de validar.',
      )
    if (
      ficha.link.estado === 'DESHABILITADO' ||
      ficha.product.estado === 'INACTIVO' ||
      ficha.version.estado === 'RETIRADA'
    ) {
      fail(
        409,
        'PRODUCTO_DESHABILITADO',
        'No se puede aprobar una ficha deshabilitada.',
      )
    }
    if (
      !bool(ficha.client.habilitado) ||
      !bool(ficha.client.wms_activo_ultima_validacion)
    )
      fail(
        409,
        'CLIENTE_DESHABILITADO',
        'El cliente no está habilitado para operar.',
      )
  }
  const key = (version) => `VERSION-${version.id}`
  async function commandFor(version, transaction, lock = false) {
    return ComandoIdempotente.findOne({
      where: { operacion: operation, clave: key(version) },
      transaction,
      ...(lock ? { lock: transaction.LOCK.UPDATE } : {}),
      order: [['id', 'ASC']],
    })
  }
  async function list(query) {
    const page = Number(query.page ?? 1),
      limit = Number(query.limit ?? 25)
    const where = {
      retirado_at: null,
      ...(query.estado && query.estado !== 'TODOS'
        ? { estado: query.estado }
        : {}),
      ...(query.cliente_id ? { cliente_id: query.cliente_id } : {}),
    }
    const { count, rows } = await ClienteProducto.findAndCountAll({
      where,
      order: [['id', 'DESC']],
      limit,
      offset: (page - 1) * limit,
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
    })
    if (!rows.length) return { total: count, page, limit, data: [] }
    const versionIds = rows.flatMap((link) =>
      link.producto.versiones.map((version) => version.id),
    )
    const [clients, actors, equivalences, commands] = await Promise.all([
      Cliente.findAll({
        where: { id: { [Op.in]: rows.map((row) => row.cliente_id) } },
      }),
      Actor.findAll({
        where: { id: { [Op.in]: rows.map((row) => row.creado_por_actor_id) } },
      }),
      ProductoEquivalencia.findAll({
        where: { producto_version_id: { [Op.in]: versionIds } },
      }),
      ComandoIdempotente.findAll({
        where: {
          operacion: operation,
          clave: { [Op.in]: versionIds.map((id) => `VERSION-${id}`) },
        },
      }),
    ])
    const data = rows.map((link) => {
      const version = link.producto.versiones[0]
      if (!version)
        fail(409, 'FICHA_INCOMPLETA', 'Una ficha del catálogo está incompleta.')
      const equivalence = equivalences.find(
        (item) => String(item.producto_version_id) === String(version.id),
      )
      const command = commands.find((item) => item.clave === key(version))
      const planned = command ? parse(command.resultado_seguro) : null
      const actor = actors.find(
        (item) => String(item.id) === String(link.creado_por_actor_id),
      )
      const client = clients.find(
        (item) => String(item.id) === String(link.cliente_id),
      )
      return {
        ...productView(link, version, link.producto, equivalence),
        cliente_id: String(link.cliente_id),
        cliente_nombre: client?.nombre_presentacion || 'Cliente',
        creado_por: actor?.nombre_presentacion || 'Usuario del cliente',
        creado_at: isoDate(link.creado_at),
        integracion:
          command?.estado === 'EN_CURSO'
            ? { estado: planned?.envio, codigo: planned?.payload?.Id_producto }
            : null,
      }
    })
    return { total: count, page, limit, data }
  }
  async function search(query, identity) {
    const q = (query.buscar || '').toLocaleLowerCase('es')
    const rows = await wms.listProducts(identity.bearer)
    return {
      data: rows
        .filter(
          (row) =>
            (!query.prefijo || row.Id_producto.startsWith(query.prefijo)) &&
            (!q ||
              [row.Id_producto, row.Nombre, row.Referencia].some((value) =>
                value.toLocaleLowerCase('es').includes(q),
              )),
        )
        .slice(0, 100),
    }
  }
  async function actor(identity, transaction) {
    if (identity.customer) return identity.customer.actor_id
    return actores.internal(identity, transaction)
  }
  async function access(identity, transaction) {
    if (identity.customer)
      await freshWriter(identity.customer, transaction, { sesiones, terminos })
  }
  async function finalize(id, input, remote, identity, context) {
    return db.transaction(async (transaction) => {
      await access(identity, transaction)
      const ficha = await load(id, transaction, true, identity.customer)
      check(ficha, input)
      const pending = await commandFor(ficha.version, transaction, true)
      const pendingPlan = pending && parse(pending.resultado_seguro)
      const reconciling =
        pending?.estado === 'EN_CURSO' && pendingPlan?.envio === 'ENVIADO'
      if (
        pending?.estado === 'EN_CURSO' &&
        pendingPlan?.envio === 'ENVIADO' &&
        pendingPlan.payload.Id_producto !== remote.Id_producto
      ) {
        fail(
          409,
          'WMS_CONFIRMACION_PENDIENTE',
          'Primero verifica el código que ya se está creando en WMS para esta ficha.',
        )
      }
      // Vincular confirma una equivalencia decidida por el administrador.
      // La coincidencia exacta solo verifica el resultado de una creación propia.
      if (
        (input.modo === 'CREAR' || reconciling) &&
        !sameProduct(ficha.version, remote)
      )
        fail(
          409,
          'FICHA_WMS_DIFERENTE',
          'La ficha WMS no corresponde al producto que se intentó crear. Revisa el resultado de esa creación.',
        )
      const existing = await ProductoEquivalencia.findOne({
        where: { producto_version_id: ficha.version.id },
        transaction,
      })
      if (existing) {
        if (existing.wms_producto_id !== remote.Id_producto)
          fail(
            409,
            'PRODUCTO_YA_VALIDADO',
            'El producto ya está vinculado a otro código WMS.',
          )
        if (identity.customer && ficha.link.estado !== 'HABILITADO') {
          await ficha.link.update({ estado: 'HABILITADO' }, { transaction })
          await auditoria.record(
            transaction,
            context,
            'PRODUCTO_CATALOGO_HABILITADO',
            'cliente_producto',
            ficha.link.id,
            {
              clientId: ficha.link.cliente_id,
              actorId: identity.customer.actor_id,
              sessionId: identity.customer.sesion_id,
              detail: {
                dispositivo_id: identity.customer.dispositivo_id,
                codigo_wms: remote.Id_producto,
              },
            },
          )
        }
        return productView(ficha.link, ficha.version, ficha.product, existing)
      }
      const occupied = await ProductoEquivalencia.findOne({
        where: { wms_producto_id: remote.Id_producto },
        transaction,
      })
      if (occupied && !identity.customer)
        fail(
          409,
          'CODIGO_WMS_YA_VINCULADO',
          'Ese código WMS ya pertenece a otra ficha de la maestra externa. Se requiere revisar la unificación de la maestra.',
        )
      const actorId = await actor(identity, transaction)
      const equivalence = await ProductoEquivalencia.create(
        {
          producto_version_id: ficha.version.id,
          wms_producto_id: remote.Id_producto,
          validado_por_actor_id: actorId,
          validado_at: new Date(),
        },
        { transaction },
      )
      await ficha.version.update(
        {
          estado: 'HOMOLOGADA',
          homologado_por_actor_id: actorId,
          homologado_at: new Date(),
        },
        { transaction },
      )
      await ficha.product.update({ estado: 'VALIDADO' }, { transaction })
      await ficha.link.update({ estado: 'HABILITADO' }, { transaction })
      const command = await commandFor(ficha.version, transaction, true)
      if (command)
        await command.update(
          {
            estado: 'COMPLETADO',
            resultado_seguro: {
              envio: 'CONFIRMADO',
              codigo: remote.Id_producto,
            },
          },
          { transaction },
        )
      await auditoria.record(
        transaction,
        context,
        'PRODUCTO_CLIENTE_VALIDADO',
        'cliente_producto',
        ficha.link.id,
        {
          clientId: ficha.link.cliente_id,
          actorId,
          sessionId: identity.customer?.sesion_id,
          detail: {
            producto_version_id: String(ficha.version.id),
            wms_producto_id: remote.Id_producto,
            modo: input.modo,
            automatico: Boolean(identity.customer),
            dispositivo_id: identity.customer?.dispositivo_id ?? null,
            ficha_wms: remote,
          },
        },
      )
      return productView(ficha.link, ficha.version, ficha.product, equivalence)
    })
  }
  async function approve(id, input, identity, context) {
    const remoteApi = identity.customer ? wms.products() : wms
    const initial = await db.transaction(async (transaction) => {
      await access(identity, transaction)
      return load(id, transaction, false, identity.customer)
    })
    check(initial, input)
    if (input.modo === 'VINCULAR') {
      if (!input.wms_producto_id)
        fail(
          400,
          'CODIGO_WMS_REQUERIDO',
          'Selecciona el producto WMS que deseas vincular.',
        )
      const pending = await commandFor(initial.version)
      const plan = pending && parse(pending.resultado_seguro)
      if (
        pending?.estado === 'EN_CURSO' &&
        plan?.envio === 'ENVIADO' &&
        plan.payload.Id_producto !== input.wms_producto_id
      ) {
        fail(
          409,
          'WMS_CONFIRMACION_PENDIENTE',
          'Primero verifica la creación WMS que ya está en curso para esta ficha.',
        )
      }
      const remote = await remoteApi.getProduct(
        input.wms_producto_id,
        identity.bearer,
      )
      if (!remote)
        fail(
          404,
          'PRODUCTO_WMS_NO_EXISTE',
          'El producto seleccionado no existe en WMS.',
        )
      return finalize(id, input, remote, identity, context)
    }
    if (input.wms_producto_id)
      fail(
        400,
        'CODIGO_AUTOMATICO',
        'La creación genera el código en servidor; no admite códigos enviados desde el navegador.',
      )
    if (!initial.version.prefijo)
      fail(
        409,
        'PREFIJO_REQUERIDO',
        'Esta ficha anterior no tiene prefijo. Requiere completar su presentación antes de crearla en WMS.',
      )
    const already = await ProductoEquivalencia.findOne({
      where: { producto_version_id: initial.version.id },
    })
    if (already && identity.customer && initial.link.estado !== 'HABILITADO') {
      const remote = await remoteApi.getProduct(already.wms_producto_id)
      if (!remote)
        fail(409, 'PRODUCTO_WMS_NO_EXISTE', 'La ficha ya no existe en Genika.')
      return finalize(id, input, remote, identity, context)
    }
    if (already)
      return productView(
        initial.link,
        initial.version,
        initial.product,
        already,
      )
    await remoteApi.validateProductPrefix(
      initial.version.prefijo,
      initial.version.tipo,
      identity.bearer,
    )
    const previous = await commandFor(initial.version)
    const previousPlan = previous && parse(previous.resultado_seguro)
    let candidate
    if (!previous || previousPlan?.envio === 'COLISION') {
      const currentProducts = await remoteApi.listProducts(identity.bearer)
      if (identity.customer) {
        const identical = matches(initial.version, currentProducts).find(
          (row) => row.exacta,
        )
        if (identical)
          return finalize(
            id,
            { ...input, modo: 'VINCULAR' },
            identical.remote,
            identity,
            context,
          )
      }
      candidate = nextCode(initial.version.prefijo, currentProducts)
      if (candidate.length > 250)
        fail(
          409,
          'CODIGO_EXCESIVO',
          'El consecutivo no cabe en el código de producto WMS.',
        )
    }
    const action = await db.transaction(async (transaction) => {
      await access(identity, transaction)
      const ficha = await load(id, transaction, true, identity.customer)
      check(ficha, input)
      let command = await commandFor(ficha.version, transaction, true)
      // Otra validación pudo terminar mientras se consultaba el consecutivo WMS.
      if (
        await ProductoEquivalencia.findOne({
          where: { producto_version_id: ficha.version.id },
          transaction,
        })
      )
        return { completed: true }
      let planned = command && parse(command.resultado_seguro)
      if (command?.estado === 'COMPLETADO') return { completed: true }
      if (!command || planned?.envio === 'COLISION') {
        if (!candidate)
          fail(
            409,
            'PRODUCTO_EN_PROCESO',
            'Actualiza la bandeja antes de continuar.',
          )
        const actorId = await actor(identity, transaction)
        planned = {
          envio: 'PENDIENTE',
          payload: productPayload(ficha.version, candidate),
        }
        const values = {
          peticion_sha256: createHash('sha256')
            .update(JSON.stringify(planned.payload))
            .digest(),
          resultado_seguro: planned,
        }
        if (command) await command.update(values, { transaction })
        else
          command = await ComandoIdempotente.create(
            {
              ...values,
              cliente_id: ficha.link.cliente_id,
              actor_id: actorId,
              operacion: operation,
              clave: key(ficha.version),
              expira_at: new Date(Date.now() + 86400000),
            },
            { transaction },
          )
      }
      const send = planned.envio === 'PENDIENTE'
      if (send) {
        planned = { ...planned, envio: 'ENVIADO' }
        await command.update({ resultado_seguro: planned }, { transaction })
        await auditoria.record(
          transaction,
          context,
          'PRODUCTO_WMS_CREACION_INICIADA',
          'cliente_producto',
          ficha.link.id,
          {
            clientId: ficha.link.cliente_id,
            actorId: command.actor_id,
            sessionId: identity.customer?.sesion_id,
            detail: {
              producto_version_id: String(ficha.version.id),
              codigo: planned.payload.Id_producto,
              automatico: Boolean(identity.customer),
              dispositivo_id: identity.customer?.dispositivo_id ?? null,
            },
          },
        )
      }
      return { send, planned, commandId: command.id }
    })
    if (action.completed) {
      const ficha = await load(id, undefined, false, identity.customer)
      return productView(
        ficha.link,
        ficha.version,
        ficha.product,
        await ProductoEquivalencia.findOne({
          where: { producto_version_id: ficha.version.id },
        }),
      )
    }
    if (action.send) {
      try {
        await remoteApi.createProduct(action.planned.payload, identity.bearer)
      } catch {
        /* La verificación siguiente resuelve respuestas perdidas sin repetir el POST. */
      }
    }
    const remote = await remoteApi.getProduct(
      action.planned.payload.Id_producto,
      identity.bearer,
    )
    if (!remote)
      fail(
        409,
        'WMS_CONFIRMACION_PENDIENTE',
        'WMS aún no confirma la creación. Usa Verificar creación; no se enviará un segundo POST.',
      )
    if (!sameProduct(initial.version, remote)) {
      await db.transaction(async (transaction) => {
        await load(id, transaction, true, identity.customer)
        const command = await ComandoIdempotente.findByPk(action.commandId, {
          transaction,
          lock: transaction.LOCK.UPDATE,
        })
        if (command.estado !== 'COMPLETADO')
          await command.update(
            { resultado_seguro: { ...action.planned, envio: 'COLISION' } },
            { transaction },
          )
      })
      fail(
        409,
        'CODIGO_WMS_OCUPADO',
        'Otro producto ocupó ese consecutivo en WMS. Vuelve a crear para calcular uno disponible.',
      )
    }
    return finalize(id, input, remote, identity, context)
  }
  return {
    list,
    search,
    approve,
    createForCustomer: (id, input, customer, context) =>
      approve(id, { ...input, modo: 'CREAR' }, { customer }, context),
  }
}
module.exports = { createProductoInternoService }
