const states = {
  SIN_LOTE: 'INGRESO_SIN_LOTE',
  PENDIENTE: 'INGRESO_AGENDADO',
  PARCIAL: 'INGRESO_PARCIAL',
  RECIBIDA: 'INGRESO_CONFIRMADO',
  CERRADA: 'INGRESO_CONFIRMADO', // El ingreso ya ocurrió; el cierre del lote viaja en recepcion.estado.
  POR_CONCILIAR: 'INGRESO_POR_CONCILIAR',
}

function createIngresoService({ precargas }) {
  async function detail(publicId, clientId = null, stocks = undefined) {
    const data = await precargas.detail(publicId, clientId, stocks)
    return {
      public_id: data.public_id,
      tipo_operacion: 'INGRESO',
      modalidad: 'INGRESO',
      nombre: data.referencia_lote,
      referencia_contenedor: data.referencia_contenedor,
      referencia_transporte: data.referencia_transporte,
      fecha_programada_at: data.fecha_programada_at,
      creado_at: data.creado_at,
      cliente_nombre: data.cliente_nombre,
      solicitado_por: data.creado_por,
      wms_lote_id: data.wms_lote_id,
      wms_alistamiento_id: null,
      destinatario: data.referencia_transporte,
      observacion: data.observacion,
      estado:
        data.estado === 'CANCELADA'
          ? 'CANCELADA'
          : states[data.recepcion?.estado] || null,
      estado_no_disponible: data.recepcion?.estado === 'NO_DISPONIBLE',
      recepcion: data.recepcion,
      permite_cambios: false,
      cambio_pendiente: false,
      detalles: data.detalles.map((row) => ({
        ...row,
        wms_lote_id: data.wms_lote_id,
        cantidad: row.cantidad_declarada,
      })),
    }
  }
  return { detail }
}
module.exports = { createIngresoService }
