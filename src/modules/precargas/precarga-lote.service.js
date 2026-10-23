const { createHash } = require('node:crypto')
const { Op } = require('sequelize')
const { freshWriter } = require('../../utils/customerAccess')
const { fail } = require('../../utils/errors')
const { bool } = require('../../utils/security')
const {
  nextLot,
  wmsQuantity,
  groupLotLines,
  sameLine,
} = require('./precarga-wms')
const parse = (value) => (typeof value === 'string' ? JSON.parse(value) : value)
const operation = 'CREAR_LOTE_PRECARGA_WMS'

function createPrecargaLoteService({
  db,
  wms,
  actores,
  auditoria,
  read,
  sesiones,
  terminos,
}) {
  const {
    Solicitud,
    Cliente,
    PrecargaLote,
    PrecargaDetalle,
    ProductoVersion,
    Producto,
    ClienteProducto,
    ProductoEquivalencia,
    ComandoIdempotente,
  } = db.models
  const key = (request) =>
    `SOLICITUD-${request.id}-REV-${request.revision_actual}`
  async function load(publicId, revision, transaction, customer = null) {
    const options = transaction
      ? { transaction, lock: transaction.LOCK.UPDATE }
      : {}
    const request = await Solicitud.findOne({
      where: {
        public_id: publicId,
        tipo: 'PRECARGA',
        ...(customer ? { cliente_id: customer.cliente_id } : {}),
      },
      ...options,
    })
    if (!request) fail(404, 'PRECARGA_NO_EXISTE', 'La precarga no existe.')
    if (request.revision_actual !== revision)
      fail(
        409,
        'PRECARGA_ACTUALIZADA',
        'La precarga cambió. Vuelve a consultar su detalle.',
      )
    if (!['ENVIADA', 'APROBADA'].includes(request.estado))
      fail(
        409,
        'PRECARGA_NO_DISPONIBLE',
        'El estado actual no permite crear el lote de esta precarga.',
      )
    const client = await Cliente.findByPk(request.cliente_id, options)
    if (
      !client ||
      !bool(client.habilitado) ||
      !bool(client.wms_activo_ultima_validacion)
    )
      fail(
        409,
        'CLIENTE_DESHABILITADO',
        'El cliente no está habilitado para operar.',
      )
    const lots = await PrecargaLote.findAll({
      where: { solicitud_id: request.id, cliente_id: request.cliente_id },
      ...options,
    })
    if (lots.length !== 1)
      fail(
        409,
        'PRECARGA_LOTES_INVALIDOS',
        'Esta precarga requiere revisión de sus lotes antes de crear el lote.',
      )
    return { request, client, lot: lots[0] }
  }
  async function linesFor(ficha, transaction) {
    const options = transaction
      ? { transaction, lock: transaction.LOCK.UPDATE }
      : {}
    const rows = await PrecargaDetalle.findAll({
      where: {
        solicitud_id: ficha.request.id,
        cliente_id: ficha.request.cliente_id,
      },
      order: [['id', 'ASC']],
      ...options,
    })
    if (!rows.length || rows.length > 25)
      fail(409, 'PRECARGA_SIN_DETALLES', 'Revisa los productos de la precarga.')
    const output = []
    for (const row of rows) {
      const link = await ClienteProducto.findByPk(
        row.cliente_producto_id,
        options,
      )
      const version = await ProductoVersion.findByPk(
        row.producto_version_id,
        options,
      )
      const product = await Producto.findByPk(row.producto_id, options)
      const equivalence = await ProductoEquivalencia.findOne({
        where: { producto_version_id: row.producto_version_id },
        ...options,
      })
      if (
        !link ||
        String(link.cliente_id) !== String(ficha.request.cliente_id) ||
        link.estado !== 'HABILITADO' ||
        !version ||
        version.estado !== 'HOMOLOGADA' ||
        !product ||
        product.estado !== 'VALIDADO' ||
        !equivalence
      )
        fail(
          409,
          'PRODUCTO_PENDIENTE_VALIDACION',
          'Todos los productos deben estar habilitados y sincronizados con Genika antes de crear el lote.',
        )
      output.push({
        id_producto: equivalence.wms_producto_id,
        Cantidad: wmsQuantity(row.cantidad_declarada),
        unidad: version.unidad_medida,
        id_Cliente: ficha.client.wms_cliente_id,
      })
    }
    // La declaración conserva sus referencias; WMS recibe una línea por producto y cliente.
    return groupLotLines(output)
  }
  async function commandFor(request, transaction) {
    return ComandoIdempotente.findOne({
      where: {
        operacion: { [Op.in]: [operation, 'APROBAR_PRECARGA_WMS'] },
        clave: key(request),
      },
      ...(transaction ? { transaction, lock: transaction.LOCK.UPDATE } : {}),
    })
  }
  async function create(publicId, input, principal, context) {
    const customer = principal.customer || null
    const remote = wms.preloads()
    async function access(transaction) {
      if (customer)
        await freshWriter(customer, transaction, { sesiones, terminos })
    }
    const initial = await db.transaction(async (transaction) => {
      await access(transaction)
      return load(publicId, input.revision, transaction, customer)
    })
    if (initial.lot.wms_lote_id)
      return read.detail(publicId, customer?.cliente_id)
    const lines = await linesFor(initial)
    await remote.validateClient(initial.client.wms_cliente_id)
    for (const line of lines) {
      const product = await remote.getProduct(line.id_producto)
      if (!product)
        fail(
          409,
          'PRODUCTO_WMS_NO_EXISTE',
          `El producto ${line.id_producto} ya no existe en WMS.`,
        )
      if (product.Unidad_de_medida !== line.unidad)
        fail(
          409,
          'UNIDADES_WMS_DIFERENTES',
          `El producto ${line.id_producto} usa otra unidad en WMS. Define la equivalencia de cantidades antes de importar; no se convierten cantidades automáticamente.`,
        )
    }
    const previous = await commandFor(initial.request)
    const previousPlan = previous && parse(previous.resultado_seguro)
    const candidate =
      !previous || previousPlan.lote.estado === 'COLISION'
        ? nextLot(await remote.listLots())
        : null
    await db.transaction(async (transaction) => {
      await access(transaction)
      const ficha = await load(publicId, input.revision, transaction, customer)
      if (ficha.lot.wms_lote_id) return
      let command = await commandFor(ficha.request, transaction)
      const previous = command && parse(command.resultado_seguro)
      if (command && previous.lote.estado !== 'COLISION') return
      const checked = await linesFor(ficha, transaction)
      if (JSON.stringify(checked) !== JSON.stringify(lines))
        fail(
          409,
          'PRODUCTO_ACTUALIZADO',
          'La vinculación de productos cambió. Revisa la precarga antes de crear el lote.',
        )
      if (!candidate)
        fail(
          409,
          'PRECARGA_EN_PROCESO',
          'Actualiza la precarga antes de continuar.',
        )
      const actorId = customer
        ? customer.actor_id
        : await actores.internal(principal.internal, transaction)
      const payload = {
        Id_lote: candidate,
        Fecha_fabri: null,
        Fecha_vence: null,
        Comentarios: `Clients Fastway / precarga ${publicId} / revisión ${input.revision} / cliente ${ficha.client.wms_cliente_id}`,
      }
      const plan = {
        lote: { estado: 'PENDIENTE', payload },
        lineas: checked.map((line) => ({
          estado: 'PENDIENTE',
          payload: {
            id_lote: candidate,
            id_producto: line.id_producto,
            Cantidad: line.Cantidad,
            id_Cliente: line.id_Cliente,
            PesoUnitarioKg: null,
          },
        })),
      }
      const values = {
        resultado_seguro: plan,
        peticion_sha256: createHash('sha256')
          .update(JSON.stringify(plan))
          .digest(),
      }
      if (command) await command.update(values, { transaction })
      else
        await ComandoIdempotente.create(
          {
            ...values,
            cliente_id: ficha.request.cliente_id,
            actor_id: actorId,
            solicitud_id: ficha.request.id,
            operacion: operation,
            clave: key(ficha.request),
            expira_at: new Date(Date.now() + 86400000),
          },
          { transaction },
        )
      await auditoria.record(
        transaction,
        context,
        'PRECARGA_LOTE_CREACION_INICIADA',
        'solicitud',
        ficha.request.id,
        {
          clientId: ficha.request.cliente_id,
          actorId,
          solicitudId: ficha.request.id,
          sessionId: customer?.sesion_id,
          detail: {
            public_id: publicId,
            revision: input.revision,
            codigo: candidate,
            dispositivo_id: customer?.dispositivo_id ?? null,
          },
        },
      )
    })
    let expectedCode = null
    async function mutate(fn) {
      return db.transaction(async (transaction) => {
        await access(transaction)
        const ficha = await load(
          publicId,
          input.revision,
          transaction,
          customer,
        )
        const command = await commandFor(ficha.request, transaction)
        if (!command)
          fail(
            409,
            'PRECARGA_EN_PROCESO',
            'No se encontró el intento de creación del lote.',
          )
        const plan = structuredClone(parse(command.resultado_seguro))
        if (expectedCode && plan.lote.payload.Id_lote !== expectedCode)
          fail(
            409,
            'INTENTO_REEMPLAZADO',
            'El intento de creación del lote cambió. Actualiza el detalle antes de continuar.',
          )
        const result = await fn(plan, ficha, command, transaction)
        await command.update({ resultado_seguro: plan }, { transaction })
        return result
      })
    }
    async function claim(index) {
      return mutate((plan) => {
        const step = index === null ? plan.lote : plan.lineas[index]
        const send = step.estado === 'PENDIENTE'
        if (send) step.estado = 'ENVIADO'
        return { send, payload: step.payload }
      })
    }
    const header = await claim(null)
    expectedCode = header.payload.Id_lote
    if (header.send) {
      try {
        await remote.createLot(header.payload)
      } catch {
        /* Verificar antes de decidir el resultado. */
      }
    }
    const remoteLot = await remote.getLot(header.payload.Id_lote)
    if (!remoteLot)
      fail(
        409,
        'WMS_CONFIRMACION_PENDIENTE',
        'WMS aún no confirma el lote. Usa Verificar creación del lote para consultar el mismo intento sin duplicarlo.',
      )
    if (remoteLot.Comentarios !== header.payload.Comentarios) {
      const retryable = await mutate((plan) => {
        const retryable = plan.lineas.every(
          (line) => line.estado === 'PENDIENTE',
        )
        if (retryable) plan.lote.estado = 'COLISION'
        return retryable
      })
      if (!retryable)
        fail(
          409,
          'LOTE_WMS_DIFERENTE',
          'El lote cambió después de empezar a importar sus líneas. Requiere conciliación antes de continuar.',
        )
      fail(
        409,
        'LOTE_WMS_OCUPADO',
        'Otro lote ocupó ese consecutivo. Vuelve a verificar la creación para calcular uno disponible.',
      )
    }
    await mutate((plan) => {
      plan.lote.estado = 'CONFIRMADO'
    })
    for (let index = 0; index < lines.length; index++) {
      const known = await remote.listLotProducts(header.payload.Id_lote)
      const step = await claim(index)
      let matches = known.filter(
        (row) => row.id_producto === step.payload.id_producto,
      )
      if (!matches.length && step.send) {
        try {
          await remote.createLotProduct(step.payload)
        } catch {
          /* Una respuesta perdida se concilia por lote/producto/cliente. */
        }
        matches = (await remote.listLotProducts(header.payload.Id_lote)).filter(
          (row) => row.id_producto === step.payload.id_producto,
        )
      }
      if (!matches.length)
        fail(
          409,
          'WMS_CONFIRMACION_PENDIENTE',
          'WMS aún no confirma todas las líneas. Usa Verificar creación del lote; las líneas enviadas no se repetirán.',
        )
      if (matches.length !== 1 || !sameLine(step.payload, matches[0]))
        fail(
          409,
          'LINEA_WMS_DIFERENTE',
          'Una línea de WMS no coincide en producto, cliente o cantidad. Requiere conciliación antes de crear el lote.',
        )
      await mutate((plan) => {
        plan.lineas[index].estado = 'CONFIRMADO'
        plan.lineas[index].referencia_remota = matches[0].id_lote_producto
      })
    }
    const remoteLines = await remote.listLotProducts(header.payload.Id_lote)
    await mutate(async (plan, ficha, command, transaction) => {
      if (ficha.lot.wms_lote_id) return
      const freshLines = await linesFor(ficha, transaction)
      if (
        freshLines.length !== plan.lineas.length ||
        freshLines.some(
          (line, index) =>
            line.id_producto !== plan.lineas[index].payload.id_producto ||
            line.Cantidad !== plan.lineas[index].payload.Cantidad ||
            line.id_Cliente !== plan.lineas[index].payload.id_Cliente,
        )
      )
        fail(
          409,
          'PRECARGA_ACTUALIZADA',
          'Los productos o cantidades cambiaron durante la creación del lote. Revisa la conciliación.',
        )
      if (
        remoteLines.length !== plan.lineas.length ||
        !plan.lineas.every(
          (line) =>
            line.estado === 'CONFIRMADO' &&
            remoteLines.some((row) => sameLine(line.payload, row)),
        )
      )
        fail(
          409,
          'LINEAS_WMS_DIFERENTES',
          'El lote WMS tiene líneas distintas a la precarga. Revisa la conciliación.',
        )
      await ficha.lot.update(
        { wms_lote_id: header.payload.Id_lote },
        { transaction },
      )
      await ficha.request.update(
        {
          version_lock: ficha.request.version_lock + 1,
        },
        { transaction },
      )
      await command.update({ estado: 'COMPLETADO' }, { transaction })
      const confirmer = customer
        ? customer.actor_id
        : await actores.internal(principal.internal, transaction)
      await auditoria.record(
        transaction,
        context,
        'PRECARGA_LOTE_CREADO',
        'solicitud',
        ficha.request.id,
        {
          clientId: ficha.request.cliente_id,
          actorId: confirmer,
          solicitudId: ficha.request.id,
          sessionId: customer?.sesion_id,
          detail: {
            public_id: publicId,
            revision: input.revision,
            wms_lote_id: header.payload.Id_lote,
            creado_por_actor_id: String(command.actor_id),
            dispositivo_id: customer?.dispositivo_id ?? null,
          },
        },
      )
    })
    return read.detail(publicId, customer?.cliente_id)
  }
  return {
    createForCustomer: (publicId, input, customer, context) =>
      create(publicId, input, { customer }, context),
    createForInternal: (publicId, input, internal, context) =>
      create(publicId, input, { internal }, context),
  }
}
module.exports = { createPrecargaLoteService }
