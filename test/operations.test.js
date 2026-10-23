const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { object } = require('../src/middlewares/validateRequest.middleware')
const {
  productBody,
  preloadBody,
  pagination,
} = require('../src/utils/businessValidation')
const { assertWriter } = require('../src/utils/customerAccess')
const { checkStructure } = require('../src/middlewares/requestGuard.middleware')

const product = {
  request_id: randomUUID(),
  prefijo: 'CAJ',
  nombre: 'Producto',
  referencia: 'Modelo',
  tipo: 'Bodega',
  unidad_medida: 'unidades',
  alto_cm: '0',
  ancho_cm: '0.0001',
  largo_cm: '9999999999.9999',
}
const preload = {
  request_id: randomUUID(),
  referencia_lote: 'LOTE-1',
  fecha_programada_at: '2026-12-01T08:00:00-05:00',
  referencia_contenedor: null,
  referencia_transporte: null,
  observacion: null,
  detalles: [
    { cliente_producto_id: '1', producto_version_id: '1', cantidad_declarada: '99999999999999.999999' },
  ],
}

test('Operaciones: rechazo de campos de pertenencia, privilegios e inyección estructural', () => {
  for (const key of [
    'cliente_id',
    'actor_id',
    'producto_id',
    'estado',
    'wms_lote_id',
  ]) {
    assert.throws(
      () => object({ ...product, [key]: '1' }, productBody, 'cuerpo'),
      { code: 'CAMPOS_NO_PERMITIDOS' }
    )
    assert.throws(
      () => object({ ...preload, [key]: '1' }, preloadBody, 'cuerpo'),
      { code: 'CAMPOS_NO_PERMITIDOS' }
    )
  }
  for (const value of [
    { $gt: '0' },
    ['1'],
    1,
    null,
    '-1',
    '1e6',
    '01',
    '1,5',
    '0',
    '0.000000',
    '1.0000001',
    '100000000000000',
  ]) {
    assert.throws(
      () =>
        object(
          {
            ...preload,
            detalles: [{ cliente_producto_id: '1', producto_version_id: '1', cantidad_declarada: value }],
          },
          preloadBody,
          'cuerpo'
        ),
      { status: 400 }
    )
  }
  assert.throws(
    () =>
      object(
        { ...preload, detalles: [{ ...preload.detalles[0], cliente_id: '2' }] },
        preloadBody,
        'cuerpo'
      ),
    { status: 400 }
  )
  assert.throws(
    () =>
      object(
        { ...preload, detalles: [preload.detalles[0], preload.detalles[0]] },
        preloadBody,
        'cuerpo'
      ),
    { code: 'PRODUCTO_REPETIDO' }
  )
  assert.throws(
    () => object({ ...product, alto_cm: '-1' }, productBody, 'cuerpo'),
    { status: 400 }
  )
  assert.throws(
    () => object({ ...product, nombre: 'a\u0000b' }, productBody, 'cuerpo'),
    { status: 400 }
  )
  assert.throws(() => pagination({ page: '1 OR 1=1' }), { status: 400 })
  assert.throws(() => pagination({ limit: '101' }), { status: 400 })
  assert.throws(() => pagination({ cliente_id: '2' }), { status: 400 })
})

test('Operaciones: límites, precisión y permisos cerrados', () => {
  assert.deepEqual(object(product, productBody, 'cuerpo'), product)
  assert.deepEqual(object(preload, preloadBody, 'cuerpo'), preload)
  assert.deepEqual(pagination({ page: '2', limit: '25' }), {
    page: 2,
    limit: 25,
  })
  for (const perfil of ['CONSULTA', undefined, 'solicitante', true])
    assert.throws(() => assertWriter({ tipo: 'NORMAL', perfil }), {
      status: 403,
    })
  assert.throws(
    () => assertWriter({ tipo: 'PROVISIONAL', perfil: 'SOLICITANTE' }),
    { status: 403 }
  )
  assertWriter({ tipo: 'NORMAL', perfil: 'SOLICITANTE' })
  for (const fields of [{codigo_cliente:'CAJ001'},{codigo_wms:'CAJ001'},{prefijo:'INVENTADO'},{tipo:'Repuesto'},{unidad_medida:'CAJA'}]) {
    assert.throws(()=>object({...product,...fields},productBody,'cuerpo'),{status:400})
  }
  const maximum = {
    ...preload,
    detalles: Array.from({ length: 25 }, (_, i) => ({
      cliente_producto_id: String(i + 1),
      producto_version_id: String(i + 1),
      cantidad_declarada: '0.000001',
    })),
  }
  assert.equal(object(maximum, preloadBody, 'cuerpo').detalles.length, 25)
  assert.throws(
    () =>
      object(
        {
          ...maximum,
          detalles: [
            ...maximum.detalles,
            { cliente_producto_id: '26', producto_version_id: '26', cantidad_declarada: '1' },
          ],
        },
        preloadBody,
        'cuerpo'
      ),
    { status: 400 }
  )
  const actual = require('../src/config/env')
  checkStructure(maximum, actual.http.maxDepth, actual.http.maxKeys)
  assert.ok(
    Buffer.byteLength(JSON.stringify(maximum)) < actual.http.bodyLimitBytes
  )
})
