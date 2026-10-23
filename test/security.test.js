const {test} = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const {gzipSync} = require('node:zlib')
const jwt = require('jsonwebtoken')
const actual = require('../src/config/env')
const {createApp} = require('../src/app')
const {createHttpServer} = require('../src/utils/httpServer')
const {createLogger} = require('../src/utils/logger')
const {createSecurity,randomSecret} = require('../src/utils/security')

test('Logger: formato único, campos permitidos y resistencia a inyección de líneas',()=>{
  const lines=[]
  const logger=createLogger({environment:'test',write:line=>lines.push(line)})
  logger.warn('VALIDACION\r\nFALSA',{codigo:'ENTRADA_INVALIDA\nFALSA',
    password:'SECRETO_NO_REGISTRAR',authorization:'Bearer SECRETO_NO_REGISTRAR',
    cookie:'SECRETO_NO_REGISTRAR',body:{password:'SECRETO_NO_REGISTRAR'},
    error:new Error('SECRETO_NO_REGISTRAR'),sql:'SECRETO_NO_REGISTRAR'})
  assert.equal(lines.length,1)
  assert.equal(lines[0].split('\n').length,2)
  assert.ok(!lines[0].includes('SECRETO_NO_REGISTRAR'))
  const logged=JSON.parse(lines[0])
  assert.equal(logged.evento,'VALIDACIONFALSA')
  assert.equal(logged.codigo,'ENTRADA_INVALIDAFALSA')
  assert.ok(logged.fecha_utc.endsWith('Z'))
})

test('El cálculo de contraseñas limita concurrencia y libera el cupo después',async()=>{
  const security=createSecurity({...actual,password:{...actual.password,N:16384,p:1,maxConcurrent:1}})
  const first=security.hashPassword(randomSecret())
  await assert.rejects(security.hashPassword(randomSecret()),{status:503,code:'AUTENTICACION_OCUPADA'})
  await first
  const password=randomSecret()
  const hash=await security.hashPassword(password)
  assert.equal(await security.verifyPassword(password,hash),true)
})

test('Frontera HTTP: entradas hostiles, correlación, errores y controles de recursos',async t=>{
  const config={...actual,nodeEnv:'test',wms:{...actual.wms,jwtSecret:randomSecret()},
    password:{...actual.password,N:16384,p:1,maxConcurrent:4},trustProxy:0,
    rate:{...actual.rate,max:10000,loginMax:1000}}
  const secret='DATOS_PRIVADOS_'+randomSecret()
  const logs=[]
  const logger=createLogger({environment:'test',write:line=>logs.push(JSON.parse(line))})
  let businessCalls=0
  const db={models:{TerminosVersion:{findOne:async()=>{
    businessCalls++
    const error=new Error(secret)
    error.name='SequelizeDatabaseError'
    error.sql='SELECT '+secret
    throw error
  }}},authenticate:async()=>true}
  const wms={validateClient:async()=>{businessCalls++;throw new Error(secret)}}
  const app=await createApp({config,db,wms,logger})
  const server=createHttpServer(app,config,logger)
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections()}))
  const base=`http://127.0.0.1:${server.address().port}`
  const admin=jwt.sign({id_usuario:7,username:'admin-test',id_personal:'personal-test',permisos:{esAdmin:true}},
    config.wms.jwtSecret,{expiresIn:'5m'})
  async function request(route,{method='GET',body,headers={}}={}) {
    const response=await fetch(base+route,{method,headers:{...(body===undefined ? {} : {'Content-Type':'application/json'}),...headers},body})
    const text=await response.text()
    const parsed=text ? JSON.parse(text) : null
    if (response.status >= 400) {
      assert.match(parsed.correlation_id,/^[a-f0-9-]{36}$/)
      assert.equal(parsed.correlation_id,response.headers.get('x-correlation-id'))
    }
    return {status:response.status,body:parsed,text,headers:response.headers}
  }
  const authorized={Authorization:`Bearer ${admin}`}
  await t.test('Rechaza inyección en tipos, claves y parámetros antes de llamar servicios',async()=>{
    const malicious=[
      ['{"username":{"$ne":null},"password":"'+secret+'"}',400],
      ['{"__proto__":{"polluted":true}}',400],
      ['{"constructor":{"prototype":{"polluted":true}}}',400],
      ['{"username":"cliente","password":"'+secret+'","perfil":"ADMIN"}',400],
      ['[]',400],['{"username":"cliente",',400],
    ]
    for (const [body,status] of malicious) assert.equal((await request('/api/auth/login',{method:'POST',body})).status,status)
    assert.equal({}.polluted,undefined)
    for (const query of ['page=1&page=2','page[$ne]=1','page=1e3','limit=0','cliente_id=1%20OR%201=1','order=secret']) {
      assert.equal((await request('/api/interno/usuarios?'+query,{headers:authorized})).status,400,query)
    }
    assert.equal((await request('/api/interno/usuarios/1%20OR%201=1/estado',{
      method:'PATCH',headers:authorized,body:'{"estado":"ACTIVO"}'})).status,400)
    assert.equal((await request('/api/interno/usuarios',{method:'POST',headers:authorized,
      body:JSON.stringify({username:'cliente-test',correo:'cliente@pruebas.invalid',wms_cliente_id:"empresa';DROP TABLE usuarios_externos--"})})).status,400)
    assert.equal((await request('/api/interno/clientes/1/habilitacion',{method:'PATCH',headers:authorized,body:'{"habilitado":"true"}'})).status,400)
    assert.equal(businessCalls,0)
  })
  await t.test('Limita tamaño, profundidad, cantidad de campos, URL y codificaciones',async()=>{
    const oversized=await request('/api/auth/login',{method:'POST',body:JSON.stringify({password:secret.repeat(400)})})
    assert.equal(oversized.status,413)
    let nested={n:1}
    for(let i=0;i<10;i++) nested={n:nested}
    assert.equal((await request('/api/auth/login',{method:'POST',body:JSON.stringify(nested)})).body.error.code,'ESTRUCTURA_EXCESIVA')
    const fields=Object.fromEntries(Array.from({length:config.http.maxKeys+1},(_,i)=>['campo'+i,i]))
    assert.equal((await request('/api/auth/login',{method:'POST',body:JSON.stringify(fields)})).body.error.code,'ESTRUCTURA_EXCESIVA')
    assert.equal((await request('/api/terminos?dato='+'a'.repeat(2100))).status,414)
    assert.equal((await request('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'password='+secret})).status,415)
    assert.equal((await request('/api/auth/login',{method:'POST',headers:{'Content-Encoding':'gzip'},body:gzipSync('{}')})).status,415)
    const malformedUtf8=await request('/api/auth/login',{method:'POST',body:Buffer.from([0x7b,0x22,0x78,0x22,0x3a,0x22,0xc3,0x28,0x22,0x7d])})
    assert.equal(malformedUtf8.status,400)
    assert.equal(malformedUtf8.body.error.code,'UTF8_INVALIDO')
    assert.equal((await request('/api/terminos',{method:'PUT',body:'{}'})).status,405)
  })
  await t.test('Oculta excepciones y no permite suplantar IP o correlación desde cabeceras',async()=>{
    const response=await request('/api/terminos',{headers:{'X-Correlation-ID':'correlacion-falsa-'+secret,'X-Forwarded-For':'198.51.100.23'}})
    assert.equal(response.status,500)
    assert.equal(response.body.error.code,'ERROR_INTERNO')
    assert.ok(!response.text.includes(secret) && !response.text.includes('SELECT'))
    const logged=logs.find(row=>row.evento==='HTTP_ERROR' && row.correlation_id===response.body.correlation_id)
    assert.equal(logged.error_tipo,'SequelizeDatabaseError')
    assert.notEqual(logged.ip,'198.51.100.23')
    assert.ok(!JSON.stringify(logs).includes(secret))
    assert.ok(!JSON.stringify(logs).includes(admin))
    const health=await request('/health')
    assert.equal(health.status,200)
    assert.equal(health.headers.get('x-content-type-options'),'nosniff')
    assert.equal(health.headers.get('x-powered-by'),null)
  })
  await t.test('Bloquea intentos por IP con respuesta uniforme y Retry-After',async()=>{
    const limitedApp=await createApp({config:{...config,rate:{...config.rate,max:2}},db,wms,logger})
    const limited=await new Promise(resolve=>{const listener=limitedApp.listen(0,'127.0.0.1',()=>resolve(listener))})
    try {
      const url=`http://127.0.0.1:${limited.address().port}/api/auth/me`
      for(let i=0;i<2;i++) {const response=await fetch(url);await response.text();assert.equal(response.status,401)}
      const response=await fetch(url)
      const body=await response.json()
      assert.equal(response.status,429)
      assert.equal(body.error.code,'LIMITE_SOLICITUDES')
      assert.ok(response.headers.get('retry-after'))
      assert.equal(response.headers.get('x-correlation-id'),body.correlation_id)
    } finally {await new Promise(resolve=>{limited.close(resolve);limited.closeAllConnections()})}
  })
  await t.test('El servidor HTTP limita cabeceras sin registrar su contenido',async()=>{
    assert.equal(server.requestTimeout,config.http.requestTimeoutMs)
    assert.equal(server.headersTimeout,config.http.headersTimeoutMs)
    const result=await new Promise((resolve,reject)=>{
      const req=http.get(base+'/health',{headers:{'X-Exceso':secret.repeat(500)}},res=>{
        let body=''
        res.on('data',chunk=>{body+=chunk})
        res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(body)}))
      })
      req.on('error',reject)
    })
    assert.equal(result.status,431)
    assert.equal(result.body.error.code,'CABECERAS_EXCESIVAS')
    const duplicate=await new Promise((resolve,reject)=>{
      const req=http.get(base+'/health',{headers:['Host','127.0.0.1','Authorization','Bearer uno','Authorization','Bearer dos']},res=>{
        let body=''
        res.on('data',chunk=>{body+=chunk})
        res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(body)}))
      })
      req.on('error',reject)
    })
    assert.equal(duplicate.status,400)
    assert.equal(duplicate.body.error.code,'CABECERA_DUPLICADA')
    assert.ok(!JSON.stringify(logs).includes(secret))
  })
})
