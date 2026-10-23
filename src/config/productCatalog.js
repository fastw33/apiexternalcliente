const genika = require('../modules/productos/catalogo-genika.json')

// Copia local de la maestra Genika; no reserva ni calcula consecutivos de WMS.
module.exports = {
  presentaciones: genika.prefijos.map(({prefijo,nombre,tipo})=>({prefijo,nombre,tipo})),
  tipos: ['Bodega','RS'],
  unidades: ['unidades','kilos','pallet'],
}
