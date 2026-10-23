const { test } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const jwt = require('jsonwebtoken')
const { createSecurity,randomSecret,passwordValue } = require('../src/utils/security')
const { createWms } = require('../src/integrations/wms/wms.client')

const config = {
  password:{pepper:randomSecret(),N:16384,p:1,minLength:12,maxLength:128,maxConcurrent:4},
  session:{hashSecret:randomSecret(),csrfSecret:randomSecret()},
  wms:{jwtSecret:randomSecret(),timeoutMs:500,maxResponseBytes:2048},
}
const security = createSecurity(config)
const claims = ()=>({id_usuario:7,username:'administrador_prueba',permisos:{esAdmin:true},
  id_personal:'personal-prueba',debe_cambiar_password:false})

test('JWT de administrador WMS: firma y vencimiento; no acepta JWT de otro servicio',()=>{
  const valid = jwt.sign(claims(),config.wms.jwtSecret,{algorithm:'HS256',expiresIn:'15m'})
  assert.equal(security.internalIdentity(`Bearer ${valid}`).id,'7')
  const wrong = jwt.sign(claims(),randomSecret(),{algorithm:'HS256',expiresIn:'15m'})
  assert.throws(()=>security.internalIdentity(`Bearer ${wrong}`),{status:401})
  const expired = jwt.sign(claims(),config.wms.jwtSecret,{expiresIn:-1})
  assert.throws(()=>security.internalIdentity(`Bearer ${expired}`),{status:401})
  const noExpiry = jwt.sign(claims(),config.wms.jwtSecret)
  assert.throws(()=>security.internalIdentity(`Bearer ${noExpiry}`),{status:401})
  const noAdmin = jwt.sign({...claims(),permisos:{esAdmin:false}},config.wms.jwtSecret,{expiresIn:'15m'})
  assert.throws(()=>security.internalIdentity(`Bearer ${noAdmin}`),{status:403})
  const otherAlgorithm = jwt.sign(claims(),config.wms.jwtSecret,{algorithm:'HS384',expiresIn:'15m'})
  assert.throws(()=>security.internalIdentity(`Bearer ${otherAlgorithm}`),{status:401})
  const changeRequired = jwt.sign({...claims(),debe_cambiar_password:true},config.wms.jwtSecret,{expiresIn:'15m'})
  assert.throws(()=>security.internalIdentity(`Bearer ${changeRequired}`),{status:401})
})

test('JWT WMS: acepta permisos como objeto o texto JSON firmado de MariaDB',()=>{
  for (const permisos of [{esAdmin:true},JSON.stringify({esAdmin:true})]) {
    const token=jwt.sign({...claims(),permisos},config.wms.jwtSecret,{algorithm:'HS256',expiresIn:'15m'})
    const identity=security.internalIdentity(`Bearer ${token}`)
    assert.equal(identity.id,'7')
    assert.equal(identity.personalId,'personal-prueba')
    assert.equal(identity.bearer,`Bearer ${token}`)
  }
})

test('JWT WMS: normalizar JSON no concede permisos ni omite firma y vencimiento',()=>{
  for (const permisos of [undefined,null,{},[],true,1,{esAdmin:false},{esAdmin:'true'},{esAdmin:1},
    '{incorrecto','null','[]',JSON.stringify({esAdmin:false}),JSON.stringify({esAdmin:'true'}),
    JSON.stringify({esAdmin:1}),JSON.stringify(JSON.stringify({esAdmin:true}))]) {
    const token=jwt.sign({...claims(),permisos},config.wms.jwtSecret,{expiresIn:'15m'})
    assert.throws(()=>security.internalIdentity(`Bearer ${token}`),{status:403,code:'ADMIN_WMS_REQUERIDO'})
  }
  const serialized={...claims(),permisos:JSON.stringify({esAdmin:true})}
  const wrong=jwt.sign(serialized,randomSecret(),{expiresIn:'15m'})
  const expired=jwt.sign(serialized,config.wms.jwtSecret,{expiresIn:-1})
  const malformed=jwt.sign({...claims(),permisos:'{incorrecto'},randomSecret(),{expiresIn:'15m'})
  for (const token of [wrong,expired,malformed]) {
    assert.throws(()=>security.internalIdentity(`Bearer ${token}`),{status:401,code:'JWT_WMS_INVALIDO'})
  }
})

test('Hash adaptativo con sal, pepper y contraseñas Unicode sin truncamiento',async()=>{
  const password = randomSecret()+'🧑🏽‍💻'.repeat(10)+'\n'
  passwordValue(password,config)
  const hash = await security.hashPassword(password)
  assert.notEqual(hash,await security.hashPassword(password))
  assert.equal(await security.verifyPassword(password,hash),true)
  assert.equal(await security.verifyPassword(password+'x',hash),false)
  const changedPepper = createSecurity({...config,password:{...config.password,pepper:randomSecret()}})
  assert.equal(await changedPepper.verifyPassword(password,hash),false)
  assert.equal(await security.verifyPassword(password,'scrypt$999999999$8$1$invalid$invalid'),false)
})

test('Separación de secretos de dispositivo/sesión y CSRF ligado a la sesión',()=>{
  const token = randomSecret()
  assert.notDeepEqual(security.digest('device',token),security.digest('session',token))
  assert.notEqual(security.csrf(token),security.csrf(randomSecret()))
})

test('Adaptador WMS solo consulta por GET y descarta documentos, rutas y datos de terceros',async t=>{
  const requests = []
  const server = http.createServer((req,res)=>{
    requests.push({method:req.method,path:req.url,auth:req.headers.authorization})
    res.setHeader('Content-Type','application/json')
    if (req.url.startsWith('/api/cliente?')) return res.end(JSON.stringify({total:2,data:[
      {id_Cliente:'cliente-prueba',Nombre:'Cliente prueba',Activo:true,documentos:{ruta:'/privado'}},
      {id_Cliente:'inactivo',Nombre:'Inactivo',Activo:false},
    ]}))
    if (req.url === '/api/cliente/inactivo') return res.end(JSON.stringify({id_Cliente:'inactivo',Nombre:'Inactivo',Activo:false}))
    if (req.url === '/api/cliente/ausente') {res.statusCode=404;return res.end('{}')}
    if (req.url === '/api/cliente/redireccion') {res.statusCode=302;res.setHeader('Location','http://example.com');return res.end()}
    if (req.url === '/api/cliente/excesivo') {
      res.write('[')
      return res.end('x'.repeat(3000)+']')
    }
    if (req.url === '/api/cliente/esquema-invalido') return res.end(JSON.stringify({id_Cliente:'esquema-invalido',Nombre:{privado:true},Activo:true}))
    res.end(JSON.stringify({id_Cliente:'cliente-prueba',Nombre:'Cliente prueba',Activo:true,
      documentos:{ruta:'/ruta-interna'},personal:{correo:'privado'},Observaciones:'Solo uso interno'}))
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections()}))
  const wms = createWms({wms:{...config.wms,baseUrl:`http://127.0.0.1:${server.address().port}`}})
  const bearer = `Bearer ${randomSecret()}`
  assert.deepEqual(await wms.listClients({page:1,limit:25},bearer),{
    data:[{wms_cliente_id:'cliente-prueba',nombre:'Cliente prueba',activo:true}],page:1,limit:25,total_wms:2,has_more:false,
  })
  assert.deepEqual(await wms.validateClient('cliente-prueba',bearer),{wms_cliente_id:'cliente-prueba',nombre:'Cliente prueba',activo:true})
  await assert.rejects(wms.validateClient('inactivo',bearer),{status:422})
  await assert.rejects(wms.validateClient('ausente',bearer),{status:404})
  await assert.rejects(wms.validateClient('redireccion',bearer),{status:503})
  await assert.rejects(wms.validateClient('excesivo',bearer),{status:502,code:'WMS_RESPUESTA_EXCESIVA'})
  await assert.rejects(wms.validateClient('esquema-invalido',bearer),{status:502,code:'WMS_RESPUESTA_INVALIDA'})
  assert.ok(requests.every(req=>req.method==='GET' && req.auth===bearer))
})
