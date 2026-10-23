const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { object } = require('../src/middlewares/validateRequest.middleware')
const { body } = require('../src/modules/operaciones/operacion.validation')
const { createWms } = require('../src/integrations/wms/wms.client')
const { validateLead } = require('../src/modules/operaciones/operacion-anticipacion')
const { validateHours, operatingHours } = require('../src/modules/operaciones/operacion-horario')
test('Llegada entre 08:00 y 17:00 de Colombia, independiente de UTC y con cierre exacto', () => {
  const config={operations:{openingTime:'08:00',closingTime:'17:00'}}
  assert.deepEqual(operatingHours(config),{inicio:'08:00',fin:'17:00',zona_horaria:'America/Bogota'})
  for (const date of ['2026-10-20T08:00:00-05:00','2026-10-20T17:00:00-05:00','2026-10-20T13:00:00Z'])
    assert.doesNotThrow(()=>validateHours(date,config))
  for (const date of ['2026-10-20T07:59:00-05:00','2026-10-20T17:01:00-05:00','2026-10-20T17:00:00.001-05:00','2026-10-20T01:00:00Z'])
    assert.throws(()=>validateHours(date,config),{code:'HORARIO_NO_PERMITIDO'})
  for (const hours of [{},{openingTime:'17:00',closingTime:'08:00'},{openingTime:'25:00',closingTime:'17:00'}])
    assert.throws(()=>operatingHours({operations:hours}),{status:503})
})
const { createSecurity } = require('../src/utils/security')
const jwt = require('jsonwebtoken')
test('Cinco horas desde el registro: límite exacto, 4h59 rechazadas y reintento conserva el plazo original', () => {
  const registered = new Date('2026-10-20T08:00:00-05:00')
  assert.doesNotThrow(() => validateLead('2026-10-20T13:00:00-05:00',registered,300))
  assert.throws(() => validateLead('2026-10-20T12:59:59.999-05:00',registered,300), { code: 'ANTICIPACION_INSUFICIENTE' })
  assert.throws(() => validateLead('2026-10-20T12:59:00-05:00',registered,300), { status: 422 })
  // Aunque la integración se ejecute más tarde, la referencia guardada no cambia.
  assert.doesNotThrow(() => validateLead('2026-10-20T13:00:00-05:00',registered,300))
  assert.throws(() => validateLead('2026-10-20T13:00:00-05:00',null,300), { code: 'PROGRAMACION_SIN_VALIDAR' })
})
test('JWT operador solo amplía el acceso a operaciones; administración conserva esAdmin', () => {
  const secret = 'fixture-seguridad-solo-pruebas'
  const security = createSecurity({ wms: { jwtSecret: secret } })
  const sign = permisos => 'Bearer '+jwt.sign({ id_usuario: 7, username: 'operador', id_personal: 'P7', permisos },secret,{expiresIn:'1h'})
  for (const permisos of [{gestionBodega:true}, JSON.stringify({gestionBodega:true})]) {
    const token = sign(permisos)
    assert.equal(security.internalIdentity(token,['gestionBodega','esAdmin']).id,'7')
    assert.throws(() => security.internalIdentity(token), { code: 'ADMIN_WMS_REQUERIDO' })
  }
  assert.throws(() => security.internalIdentity(sign({gestionBodega:'true'}),['gestionBodega','esAdmin']), { status: 403 })
  assert.throws(() => security.internalIdentity(sign({inventario:true}),['gestionBodega','esAdmin']), { status: 403 })
  assert.equal(security.internalIdentity(sign({inventario:true}),[]).id,'7')
  assert.throws(()=>security.internalIdentity('Bearer invalido',[]),{status:401})
  assert.throws(()=>security.internalIdentity(undefined,[]),{status:401})
})
const config = {
  wms: {
    baseUrl: 'http://wms.invalid',
    timeoutMs: 1000,
    maxResponseBytes: 4096,
    internalServiceKey: 'solo-fixture',
  },
}
test('Consulta de estados mantiene lotes de 25 aunque la página solicite más registros', async () => {
  const ids=Array.from({length:60},()=>randomUUID()), batches=[]
  const client=createWms(config,{fetchImpl:async url=>{
    const query=new URL(url).searchParams
    const current=query.get('request_ids').split(',')
    batches.push(current.length)
    return Response.json(current.map(uuid=>({request_id:uuid,id_cliente:'EMPRESA',id_alistamiento:ids.indexOf(uuid)+1,estado:'ABIERTO',etapa:'PENDIENTE'})))
  }})
  assert.equal((await client.operations().statuses(ids,'EMPRESA')).length,60)
  assert.deepEqual(batches,[25,25,10])
})
const input = () => ({
  request_id: randomUUID(),
  nombre: 'Recogida',
  modalidad: 'RECOGIDA',
  fecha_programada_at: '2026-11-20T10:00:00-05:00',
  destinatario: null,
  direccion_entrega: null,
  observacion: null,
  detalles: [{ codigo_wms: 'YUT001', wms_lote_id: 'GEN_001', cantidad: '0.3' }],
})
test('Una recogida no se limita al tamaño de página ni a 400 líneas',()=>{
  for(const count of [100,400,500]) {
    const value=input()
    value.detalles=Array.from({length:count},(_,index)=>({...value.detalles[0],codigo_wms:'CAJ_'+index}))
    assert.equal(object(value,body,'cuerpo').detalles.length,count)
  }
})
test('Agenda: zona Colombia explícita, fechas reales, cantidades conciliables y sin campos de privilegio', () => {
  const value = input()
  assert.deepEqual(object(value, body, 'cuerpo'), value)
  for (const date of [
    '2026-02-30T10:00:00-05:00',
    '2026-11-20T10:00:00Z',
    '2026-11-20T10:00',
    '2026-11-20T10:00:00+01:00',
  ])
    assert.throws(
      () => object({ ...value, fecha_programada_at: date }, body, 'cuerpo'),
      { status: 400 },
    )
  for (const key of [
    'id_personal',
    'cliente_id',
    'estado',
    'id_ubicacion_origen',
  ])
    assert.throws(() => object({ ...value, [key]: 'X' }, body, 'cuerpo'), {
      code: 'CAMPOS_NO_PERMITIDOS',
    })
  assert.throws(
    () =>
      object(
        { ...value, detalles: [value.detalles[0], value.detalles[0]] },
        body,
        'cuerpo',
      ),
    { code: 'PRODUCTO_REPETIDO' },
  )
  assert.throws(() =>
    object(
      {
        ...value,
        detalles: [{ ...value.detalles[0], cantidad: '99999999999999.999999' }],
      },
      body,
      'cuerpo',
    ),
  )
})
test('Adaptador de operaciones: credencial privada, consulta agrupada, lista de campos y fallo seguro', async () => {
  const uuid = randomUUID(),
    calls = []
  const response = {
    request_id: uuid,
    id_cliente: 'EMPRESA',
    id_alistamiento: 8,
    estado: 'ABIERTO',
    etapa: 'PENDIENTE',
    id_ubicacion_origen: 'NO-EXPONER',
    payload_sha256: 'NO-EXPONER',
  }
  let mode = 'normal'
  const client = createWms(config, {
    fetchImpl: async (url, options) => {
      calls.push({ url, options })
      if (mode === 'missing')
        return Response.json({ message: 'No encontrada' }, { status: 404 })
      if (mode === 'conflict')
        return Response.json(
          { message: 'Texto interno que no debe propagarse' },
          { status: 409 },
        )
      if (mode === 'unauthorized') return Response.json({}, { status: 401 })
      const row =
        mode === 'wrong' ? { ...response, id_cliente: 'AJENA' } : response
      return Response.json(url.includes('?') ? [row] : row)
    },
  })
  const api = client.operations()
  const created = await api.create({ request_id: uuid })
  assert.equal(created.id_alistamiento, 8)
  assert.equal(JSON.stringify(created).includes('NO-EXPONER'), false)
  assert.deepEqual(await api.statuses([uuid], 'EMPRESA'), [created])
  assert.equal(new URL(calls[1].url).searchParams.get('id_cliente'), 'EMPRESA')
  for (const call of calls) {
    assert.equal(call.options.headers['x-internal-service-key'], 'solo-fixture')
    assert.equal(call.options.headers.Authorization, undefined)
  }
  mode = 'wrong'
  await assert.rejects(() => api.statuses([uuid], 'EMPRESA'), {
    code: 'WMS_RESPUESTA_INVALIDA',
  })
  mode = 'missing'
  assert.equal(await api.obtain(uuid), null)
  mode = 'conflict'
  await assert.rejects(
    () => api.create({ request_id: uuid }),
    (error) =>
      error.code === 'ALISTAMIENTO_NO_DISPONIBLE' &&
      !error.message.includes('Texto interno'),
  )
  mode = 'unauthorized'
  await assert.rejects(() => api.obtain(uuid), { status: 503 })
})
