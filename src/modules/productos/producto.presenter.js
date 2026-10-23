function productView(link, version, product, equivalence = null) {
  return {
    cliente_producto_id: String(link.id),
    producto_version_id: String(version.id),
    codigo_cliente: link.codigo_cliente,
    codigo_wms: equivalence?.wms_producto_id ?? null,
    prefijo: version.prefijo ?? null,
    nombre: link.alias_cliente || version.nombre,
    referencia: version.referencia,
    tipo: version.tipo,
    unidad_medida: version.unidad_medida,
    alto_cm: String(version.alto_cm),
    ancho_cm: String(version.ancho_cm),
    largo_cm: String(version.largo_cm),
    estado:
      product.estado === 'INACTIVO' || version.estado === 'RETIRADA'
        ? 'DESHABILITADO'
        : link.estado,
  }
}
module.exports = { productView }
