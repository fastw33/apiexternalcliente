const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const mysql = require('mysql2/promise')
const jwt = require('jsonwebtoken')
const actual = require('../src/config/env')
const { createConnection } = require('../src/config/db')
const { initializeModels } = require('../src/models')
const { inspectDatabase } = require('../scripts/inspect-database')
const { createApp } = require('../src/app')
const { randomSecret } = require('../src/utils/security')
const { AppError } = require('../src/utils/errors')
const { createLogger } = require('../src/utils/logger')

function client(baseUrl,config,bearer) {
  const cookies = new Map()
  let csrfToken
  return {
    cookies,
    async request(route,{method='GET',data,csrf=true,origin,headers={}}={}) {
      const response = await fetch(baseUrl+route,{method,redirect:'manual',headers:{
        ...(bearer ? {Authorization:`Bearer ${bearer}`} : {}),
        ...(cookies.size ? {Cookie:[...cookies].map(([key,value])=>`${key}=${value}`).join('; ')} : {}),
        ...(data === undefined ? {} : {'Content-Type':'application/json'}),
        ...(csrfToken && csrf ? {'X-CSRF-Token':csrfToken} : {}),
        ...(origin ? {Origin:origin} : {}),...headers },body:data === undefined ? undefined : JSON.stringify(data)})
      for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(';')[0]
        const at = pair.indexOf('=')
        const key = pair.slice(0,at)
        const value = pair.slice(at+1)
        value ? cookies.set(key,value) : cookies.delete(key)
      }
      const text = await response.text()
      const body = text ? JSON.parse(text) : null
      if (body?.csrf_token) csrfToken = body.csrf_token
      return {status:response.status,body,headers:response.headers,text}
    },
  }
}

test('Primer bloque con MariaDB aislada: altas, contraseña temporal, sesiones, aislamiento y revocación',async t=>{
  const schema = 'externalclientes_test_'+crypto.randomBytes(8).toString('hex')
  const config = {...actual,nodeEnv:'test',operations:{...actual.operations,changesEnabled:true},db:{...actual.db,database:schema,connectionLimit:4},
    wms:{...actual.wms,jwtSecret:randomSecret()},password:{...actual.password,N:16384,p:1,pepper:randomSecret()},
    session:{...actual.session,hashSecret:randomSecret(),csrfSecret:randomSecret()},
    rate:{...actual.rate,max:10000,loginMax:1000},cookie:{...actual.cookie,secure:false}}
  // Solo se crea y elimina esta base aleatoria de pruebas, nunca externalclientes/WMS.
  assert.match(schema,/^externalclientes_test_[a-f0-9]{16}$/)
  assert.notEqual(schema,actual.db.database)
  const {connectionLimit,...directDb} = actual.db
  const bootstrap = await mysql.createConnection({...directDb,database:undefined,multipleStatements:false})
  let db,server,fixturePool
  const fixture = async fn=>{
    const conn=await fixturePool.getConnection()
    try {await conn.query("SET time_zone = '+00:00'");return await fn(conn)}
    finally {conn.release()}
  }
  t.after(async()=>{
    if (server) await new Promise(resolve=>{server.close(resolve);server.closeAllConnections()})
    if (db) await db.close()
    if (fixturePool) await fixturePool.end()
    assert.match(schema,/^externalclientes_test_[a-f0-9]{16}$/)
    assert.notEqual(schema,actual.db.database)
    await bootstrap.query(`DROP DATABASE IF EXISTS \`${schema}\``)
    await bootstrap.end()
  })
  const sql = ['001-inicial.sql','002-terminos.sql','003-producto-prefijo.sql','004-catalogo-bodega-compartido.sql','005-retiro-catalogo-cliente.sql','006-operaciones.sql','007-cambios-operacion.sql'].map(file=>fs.readFileSync(path.join(config.root,'database',file),'utf8')).join('\n')
    .split('\n').filter(line=>!line.trim().startsWith('--')).join('\n')
    .replaceAll('`externalclientes`','`'+schema+'`')
  for (const statement of sql.split(';').map(v=>v.trim()).filter(Boolean)) await bootstrap.query(statement)
  fixturePool=mysql.createPool({...config.db,timezone:'Z',charset:'utf8mb4_unicode_ci',dateStrings:true,multipleStatements:false})
  db = createConnection(config.db)
  initializeModels(db,{operationChanges:true})
  const inspected = await inspectDatabase(db)
  assert.equal(inspected.tables,34)
  assert.equal(inspected.foreign_keys,77)
  const wms = {
    listClients:async()=>({data:[{wms_cliente_id:'empresa-a',nombre:'Empresa empresa-a',activo:true}],page:1,limit:25,total_wms:1,has_more:false}),
    validateClient:async id=>{
      if (id === 'inactivo') throw new AppError(422,'CLIENTE_WMS_INACTIVO','Cliente inactivo.')
      if (id === 'ausente') throw new AppError(404,'CLIENTE_WMS_NO_EXISTE','Cliente ausente.')
      return {wms_cliente_id:id,nombre:'Empresa '+id,activo:true}
    },
  }
  const httpLogs=[]
  const logger=createLogger({environment:'test',write:line=>httpLogs.push(JSON.parse(line))})
  const app = await createApp({config,db,wms,logger})
  server = await new Promise(resolve=>{const instance=app.listen(0,'127.0.0.1',()=>resolve(instance))})
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  const payload = {id_usuario:7,username:'admin-prueba',id_personal:'personal-prueba',permisos:{esAdmin:true},debe_cambiar_password:false}
  const adminToken = jwt.sign(payload,config.wms.jwtSecret,{expiresIn:'15m'})
  const admin = client(baseUrl,config,adminToken)
  const createUser = async(username,wmsId='empresa-a')=>{
    const response = await admin.request('/api/interno/usuarios',{method:'POST',data:{wms_cliente_id:wmsId,username,correo:username+'@pruebas.invalid'}})
    assert.equal(response.status,201,response.text)
    return response.body
  }
  let account,first,normalPassword,terms
  const publishTerms = async version=>{
    const response=await admin.request('/api/interno/terminos',{method:'POST',data:{version,
      titulo:'Condiciones de prueba',contenido:'Documento ficticio solo para integración:\n\n'+version}})
    assert.equal(response.status,201,response.text)
    return response.body
  }
  const acceptance = document=>({version:document.version,contenido_sha256:document.contenido_sha256,
    acepto:true,autoriza_tratamiento_datos:true})

  await t.test('No hay registro público; un JWT WMS sin admin no crea usuarios',async()=>{
    const anonymous = client(baseUrl,config)
    assert.equal((await anonymous.request('/api/auth/register',{method:'POST',data:{}})).status,404)
    assert.equal((await anonymous.request('/api/interno/usuarios')).status,401)
    const nonAdmin = client(baseUrl,config,jwt.sign({...payload,permisos:{}},config.wms.jwtSecret,{expiresIn:'15m'}))
    assert.equal((await nonAdmin.request('/api/interno/usuarios',{method:'POST',data:{}})).status,403)
  })
  await t.test('Cliente inexistente o inactivo no se habilita',async()=>{
    const listed = await admin.request('/api/interno/clientes')
    assert.equal(listed.status,200)
    assert.equal(listed.body.data[0].wms_cliente_id,'empresa-a')
    for (const [id,status] of [['ausente',404],['inactivo',422]]) {
      const response = await admin.request('/api/interno/usuarios',{method:'POST',data:{wms_cliente_id:id,username:'no-debe-crearse',correo:'prueba@pruebas.invalid'}})
      assert.equal(response.status,status)
    }
  })
  await t.test('Alta válida: hash en base y contraseña temporal solo en respuesta privada',async()=>{
    account = await createUser('cliente-a')
    const [[stored]] = await fixture(c=>c.execute('SELECT password_hash,debe_cambiar_password FROM usuarios_externos WHERE id=?',[account.usuario.id]))
    assert.ok(stored.password_hash.startsWith('scrypt$'))
    assert.notEqual(stored.password_hash,account.password_temporal)
    assert.equal(stored.debe_cambiar_password,1)
    const listed = await admin.request('/api/interno/usuarios')
    assert.equal(listed.status,200)
    assert.ok(!listed.text.includes('password_hash') && !listed.text.includes(account.password_temporal))
  })
  await t.test('Un duplicado revierte actor y cliente nuevos, sin huérfanos',async()=>{
    const [[before]] = await fixture(c=>c.query('SELECT COUNT(*) AS n FROM actores'))
    const duplicate = await admin.request('/api/interno/usuarios',{method:'POST',data:{wms_cliente_id:'empresa-b-rollback',username:'cliente-a',correo:'otra@pruebas.invalid'}})
    assert.equal(duplicate.status,409)
    const [[after]] = await fixture(c=>c.query('SELECT COUNT(*) AS n FROM actores'))
    assert.equal(Number(after.n),Number(before.n))
    const [[mapped]] = await fixture(c=>c.execute('SELECT COUNT(*) AS n FROM clientes_vinculados WHERE wms_cliente_id=?',['empresa-b-rollback']))
    assert.equal(Number(mapped.n),0)
  })
  await t.test('Primer login: cookies HttpOnly y sesión provisional que no puede operar',async()=>{
    first = client(baseUrl,config)
    const response = await first.request('/api/auth/login',{method:'POST',data:{username:'cliente-a',password:account.password_temporal,nombre_dispositivo:'Navegador A'}})
    assert.equal(response.status,200,response.text)
    assert.equal(response.body.sesion.tipo,'PROVISIONAL')
    assert.equal(response.body.usuario.debe_cambiar_password,true)
    assert.equal(response.body.terminos.requerida,true)
    assert.equal(response.body.terminos.disponible,false)
    assert.equal(response.body.habilitado_para_operar,false)
    assert.equal((await first.request('/api/auth/terminos')).status,200)
    assert.equal((await first.request('/api/auth/terminos/aceptacion',{method:'POST',data:{}})).body.error.code,'CAMBIO_PASSWORD_REQUERIDO')
    assert.match(response.headers.get('set-cookie'),/HttpOnly/i)
    assert.ok(!response.text.includes(first.cookies.get(config.cookie.sessionName)))
    assert.equal((await first.request('/api/auth/sesiones')).status,403)
  })
  await t.test('CSRF y Origin se validan antes de cambiar contraseñas',async()=>{
    normalPassword = randomSecret()+'🦊'.repeat(50)+'\n'
    assert.equal((await first.request('/api/auth/password',{method:'POST',csrf:false,data:{password_actual:account.password_temporal,password_nueva:normalPassword}})).status,403)
    assert.equal((await first.request('/api/auth/password',{method:'POST',origin:'https://no-autorizado.invalid',data:{password_actual:account.password_temporal,password_nueva:normalPassword}})).status,403)
  })
  await t.test('Cambiar contraseña rota la sesión, pero no permite operar sin términos publicados',async()=>{
    const old = new Map(first.cookies)
    const changed = await first.request('/api/auth/password',{method:'POST',data:{password_actual:account.password_temporal,password_nueva:normalPassword}})
    assert.equal(changed.status,200,changed.text)
    assert.equal(changed.body.sesion.tipo,'NORMAL')
    assert.equal(changed.body.usuario.debe_cambiar_password,false)
    assert.equal(changed.body.habilitado_para_operar,false)
    assert.notEqual(first.cookies.get(config.cookie.sessionName),old.get(config.cookie.sessionName))
    const stolen = client(baseUrl,config)
    for (const [key,value] of old) stolen.cookies.set(key,value)
    assert.equal((await stolen.request('/api/auth/me')).status,401)
    assert.equal((await first.request('/api/auth/sesiones')).body.error.code,'TERMINOS_NO_PUBLICADOS')
  })
  await t.test('Solo el administrador publica versiones completas e inmutables',async()=>{
    const anonymous=client(baseUrl,config)
    assert.equal((await anonymous.request('/api/interno/terminos',{method:'POST',data:{}})).status,401)
    assert.equal((await first.request('/api/interno/terminos',{method:'POST',data:{}})).status,401)
    const incomplete=await admin.request('/api/interno/terminos',{method:'POST',data:{version:'borrador',titulo:'Borrador',contenido:'Correo [PENDIENTE CORREO]'}})
    assert.equal(incomplete.status,400)
    terms=await publishTerms('prueba-1')
    assert.equal(terms.contenido_sha256,crypto.createHash('sha256').update(terms.contenido).digest('hex'))
    assert.equal((await anonymous.request('/api/terminos')).body.documento.version,terms.version)
    const duplicate=await admin.request('/api/interno/terminos',{method:'POST',data:{version:terms.version,titulo:'Cambio',contenido:'No puede reemplazarse'}})
    assert.equal(duplicate.status,409)
    assert.equal((await admin.request('/api/interno/terminos/1',{method:'PATCH',data:{contenido:'Cambio'}})).status,404)
  })
  await t.test('Exige dos confirmaciones explícitas, CSRF y el contenido vigente',async()=>{
    const pending=await first.request('/api/auth/terminos')
    assert.equal(pending.body.aceptado,false)
    assert.equal(pending.body.documento.contenido,terms.contenido)
    assert.equal((await first.request('/api/auth/sesiones')).body.error.code,'TERMINOS_REQUERIDOS')
    assert.equal((await first.request('/api/auth/terminos/aceptacion',{method:'POST',csrf:false,data:acceptance(terms)})).status,403)
    for (const input of [{...acceptance(terms),acepto:false},{...acceptance(terms),acepto:'true'},
      {...acceptance(terms),autoriza_tratamiento_datos:false}]) {
      assert.equal((await first.request('/api/auth/terminos/aceptacion',{method:'POST',data:input})).status,400)
    }
    assert.equal((await first.request('/api/auth/terminos/aceptacion',{method:'POST',data:{...acceptance(terms),version:'anterior'}})).status,409)
    assert.equal((await first.request('/api/auth/terminos/aceptacion',{method:'POST',data:{...acceptance(terms),contenido_sha256:'0'.repeat(64)}})).status,409)
    assert.equal((await first.request('/api/auth/terminos/aceptacion',{method:'POST',data:{...acceptance(terms),usuario_id:999}})).status,400)
  })
  await t.test('La aceptación es individual, idempotente y conserva evidencia de sesión y dispositivo',async()=>{
    const responses=await Promise.all([1,2].map(()=>first.request('/api/auth/terminos/aceptacion',{method:'POST',data:acceptance(terms)})))
    assert.ok(responses.every(response=>response.status===200),JSON.stringify(responses.map(r=>r.body)))
    assert.equal(responses[0].body.aceptado_at,responses[1].body.aceptado_at)
    const me=await first.request('/api/auth/me')
    assert.equal(me.body.habilitado_para_operar,true)
    assert.equal(me.body.terminos.aceptado,true)
    assert.equal((await first.request('/api/auth/sesiones')).status,200)
    const [receipts]=await fixture(c=>c.execute('SELECT * FROM terminos_aceptaciones WHERE usuario_id=?',[account.usuario.id]))
    assert.equal(receipts.length,1)
    assert.equal(String(receipts[0].cliente_id),String(account.usuario.cliente_id))
    assert.equal(String(receipts[0].sesion_id),me.body.sesion.id)
    assert.equal(String(receipts[0].dispositivo_id),me.body.dispositivo.id)
    assert.ok(receipts[0].ip_origen && receipts[0].navegador && receipts[0].correlation_id && receipts[0].aceptado_at)
    const [[audit]]=await fixture(c=>c.execute("SELECT COUNT(*) AS n FROM eventos_auditoria WHERE codigo_evento='TERMINOS_ACEPTADOS' AND actor_id=(SELECT actor_id FROM usuarios_externos WHERE id=?)",[account.usuario.id]))
    assert.equal(Number(audit.n),1)
  })
  await t.test('Login Unicode y nuevo dispositivo: solo hashes persistidos',async()=>{
    const second = client(baseUrl,config)
    const response = await second.request('/api/auth/login',{method:'POST',data:{username:'cliente-a',password:normalPassword,nombre_dispositivo:'Navegador B'}})
    assert.equal(response.status,200,response.text)
    assert.equal(response.body.terminos.aceptado,true)
    const list = await first.request('/api/auth/sesiones')
    assert.equal(list.body.data.length,2)
    const other = list.body.data.find(row=>!row.actual)
    assert.equal((await first.request('/api/auth/sesiones/'+other.id,{method:'DELETE'})).status,204)
    assert.equal((await second.request('/api/auth/me')).status,401)
    const [[stored]] = await fixture(c=>c.execute('SELECT secreto_hash FROM sesiones WHERE id=?',[response.body.sesion.id]))
    assert.ok(Buffer.isBuffer(stored.secreto_hash) && stored.secreto_hash.length===32)
  })
  await t.test('Una empresa no puede consultar ni revocar sesiones de otra',async()=>{
    const otherAccount = await createUser('cliente-b','empresa-b')
    const other = client(baseUrl,config)
    const logged = await other.request('/api/auth/login',{method:'POST',data:{username:'cliente-b',password:otherAccount.password_temporal}})
    assert.equal(logged.status,200)
    assert.equal(logged.body.terminos.aceptado,false)
    assert.equal((await first.request('/api/auth/sesiones/'+logged.body.sesion.id,{method:'DELETE'})).status,404)
    const [users] = await fixture(c=>c.query('SELECT id,cliente_id FROM usuarios_externos ORDER BY id'))
    const [devices] = await fixture(c=>c.query('SELECT id,usuario_id,cliente_id FROM dispositivos ORDER BY id'))
    await assert.rejects(fixture(c=>c.execute(`INSERT INTO sesiones
      (cliente_id,usuario_id,dispositivo_id,secreto_hash,tipo,version_credenciales,ip_inicio,navegador_inicio,ultimo_uso_at,expira_at)
      VALUES (?,?,?,?,'NORMAL',1,'127.0.0.1','prueba',UTC_TIMESTAMP(6),DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 1 HOUR))`,
    [users[0].cliente_id,users[0].id,devices.find(d=>String(d.usuario_id)===String(users[1].id)).id,crypto.randomBytes(32)])),
    {code:'ER_NO_REFERENCED_ROW_2'})
  })
  await t.test('Otra persona del mismo cliente debe aceptar por sí misma y puede salir sin aceptar',async()=>{
    const another=await createUser('cliente-a-otra-persona')
    const browser=client(baseUrl,config)
    const logged=await browser.request('/api/auth/login',{method:'POST',data:{username:'cliente-a-otra-persona',password:another.password_temporal}})
    assert.equal(logged.status,200)
    assert.equal(logged.body.terminos.aceptado,false)
    const changed=await browser.request('/api/auth/password',{method:'POST',data:{password_actual:another.password_temporal,password_nueva:randomSecret()}})
    assert.equal(changed.status,200)
    assert.equal(changed.body.habilitado_para_operar,false)
    assert.equal((await browser.request('/api/auth/sesiones')).body.error.code,'TERMINOS_REQUERIDOS')
    const [[receipt]]=await fixture(c=>c.execute('SELECT COUNT(*) AS n FROM terminos_aceptaciones WHERE usuario_id=?',[another.usuario.id]))
    assert.equal(Number(receipt.n),0)
    assert.equal((await browser.request('/api/auth/logout',{method:'POST'})).status,204)
  })
  await t.test('Una nueva versión bloquea sesiones existentes y conserva las aceptaciones anteriores',async()=>{
    const previous=terms
    terms=await publishTerms('prueba-2')
    assert.equal((await first.request('/api/auth/me')).body.habilitado_para_operar,false)
    assert.equal((await first.request('/api/auth/sesiones')).body.error.code,'TERMINOS_REQUERIDOS')
    assert.equal((await first.request('/api/auth/terminos/aceptacion',{method:'POST',data:acceptance(previous)})).status,409)
    assert.equal((await first.request('/api/auth/terminos/aceptacion',{method:'POST',data:acceptance(terms)})).status,200)
    assert.equal((await first.request('/api/auth/sesiones')).status,200)
    const [[receipts]]=await fixture(c=>c.execute('SELECT COUNT(*) AS n FROM terminos_aceptaciones WHERE usuario_id=?',[account.usuario.id]))
    assert.equal(Number(receipts.n),2)
  })
  await t.test('Suspender y reactivar no revive sesiones anteriores',async()=>{
    assert.equal((await admin.request('/api/interno/usuarios/'+account.usuario.id+'/estado',{method:'PATCH',data:{estado:'SUSPENDIDO'}})).status,200)
    assert.equal((await first.request('/api/auth/me')).status,401)
    const fresh = client(baseUrl,config)
    assert.equal((await fresh.request('/api/auth/login',{method:'POST',data:{username:'cliente-a',password:normalPassword}})).status,401)
    assert.equal((await admin.request('/api/interno/usuarios/'+account.usuario.id+'/estado',{method:'PATCH',data:{estado:'ACTIVO'}})).status,200)
    assert.equal((await first.request('/api/auth/me')).status,401)
    assert.equal((await fresh.request('/api/auth/login',{method:'POST',data:{username:'cliente-a',password:normalPassword}})).status,200)
    first = fresh
  })
  await t.test('Restablecer clave revoca sesiones y exige otra vez cambio obligatorio',async()=>{
    const reset = await admin.request('/api/interno/usuarios/'+account.usuario.id+'/password-temporal',{method:'POST'})
    assert.equal(reset.status,200,reset.text)
    assert.equal((await first.request('/api/auth/me')).status,401)
    const provisional = client(baseUrl,config)
    assert.equal((await provisional.request('/api/auth/login',{method:'POST',data:{username:'cliente-a',password:normalPassword}})).status,401)
    const logged = await provisional.request('/api/auth/login',{method:'POST',data:{username:'cliente-a',password:reset.body.password_temporal}})
    assert.equal(logged.status,200)
    assert.equal(logged.body.sesion.tipo,'PROVISIONAL')
    first = provisional
  })
  await t.test('Logout con CSRF revoca sesión y es idempotente',async()=>{
    assert.equal((await first.request('/api/auth/logout',{method:'POST',csrf:false})).status,403)
    assert.equal((await first.request('/api/auth/logout',{method:'POST'})).status,204)
    assert.equal((await first.request('/api/auth/me')).status,401)
    assert.equal((await first.request('/api/auth/logout',{method:'POST'})).status,204)
  })
  await t.test('La sesión queda ligada al navegador registrado y caduca por inactividad',async()=>{
    const created = await createUser('sesion-caducidad','empresa-c')
    const browser = client(baseUrl,config)
    const response = await browser.request('/api/auth/login',{method:'POST',data:{username:'sesion-caducidad',password:created.password_temporal}})
    assert.equal(response.status,200)
    const incomplete = client(baseUrl,config)
    incomplete.cookies.set(config.cookie.sessionName,browser.cookies.get(config.cookie.sessionName))
    assert.equal((await incomplete.request('/api/auth/me')).status,401)
    await fixture(c=>c.execute('UPDATE sesiones SET ultimo_uso_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 31 MINUTE) WHERE id=?',[response.body.sesion.id]))
    assert.equal((await browser.request('/api/auth/me')).status,401)
  })
  await t.test('Contraseña temporal vencida y bloqueo por intentos no generan sesión',async()=>{
    const expired = await createUser('temporal-vencida','empresa-d')
    await fixture(c=>c.execute('UPDATE usuarios_externos SET password_temporal_expira_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 MINUTE) WHERE id=?',[expired.usuario.id]))
    const browser = client(baseUrl,config)
    assert.equal((await browser.request('/api/auth/login',{method:'POST',data:{username:'temporal-vencida',password:expired.password_temporal}})).status,401)
    const locked = await createUser('cuenta-bloqueada','empresa-d')
    for (let i=0;i<config.rate.accountFailures;i++) {
      assert.equal((await browser.request('/api/auth/login',{method:'POST',data:{username:'cuenta-bloqueada',password:randomSecret()}})).status,401)
    }
    assert.equal((await browser.request('/api/auth/login',{method:'POST',data:{username:'cuenta-bloqueada',password:locked.password_temporal}})).status,401)
    const [[stored]] = await fixture(c=>c.execute('SELECT bloqueado_hasta_at FROM usuarios_externos WHERE id=?',[locked.usuario.id]))
    assert.ok(stored.bloqueado_hasta_at)
  })
  await t.test('Crear otra cuenta no reactiva un cliente suspendido',async()=>{
    const mapped = await createUser('empresa-suspendida','empresa-e')
    assert.equal((await admin.request('/api/interno/clientes/'+mapped.usuario.cliente_id+'/habilitacion',{method:'PATCH',data:{habilitado:false}})).status,200)
    const denied = await admin.request('/api/interno/usuarios',{method:'POST',data:{wms_cliente_id:'empresa-e',username:'no-reactivar',correo:'no-reactivar@pruebas.invalid'}})
    assert.equal(denied.status,422)
    const browser = client(baseUrl,config)
    assert.equal((await browser.request('/api/auth/login',{method:'POST',data:{username:'empresa-suspendida',password:mapped.password_temporal}})).status,401)
  })
  await t.test('La bitácora conserva actor/sesión/hora, sin contraseñas ni JWT',async()=>{
    const [rows] = await fixture(c=>c.query('SELECT codigo_evento,correlation_id,detalle_interno,creado_at FROM eventos_auditoria'))
    assert.ok(rows.length > 10)
    assert.ok(rows.some(row=>row.codigo_evento==='PASSWORD_CAMBIADA'))
    const serialized = JSON.stringify(rows)
    assert.ok(!serialized.includes(account.password_temporal) && !serialized.includes(normalPassword) && !serialized.includes(adminToken))
    assert.ok(rows.every(row=>row.correlation_id && row.creado_at))
    assert.ok(httpLogs.some(row=>row.evento==='HTTP_ERROR' && row.codigo==='CSRF_INVALIDO'))
    assert.ok(httpLogs.some(row=>row.evento==='HTTP_COMPLETADA' && row.usuario_id===account.usuario.id))
    const logs=JSON.stringify(httpLogs)
    assert.ok(!logs.includes(account.password_temporal) && !logs.includes(normalPassword) && !logs.includes(adminToken))
    assert.ok(!logs.includes('password_hash') && !logs.includes('csrf_token'))
  })
})
