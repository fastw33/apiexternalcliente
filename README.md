# externalclientes

API propia de Clients Fastway. Node **24.22.0 LTS**, Express, Sequelize 6 y MariaDB. Implementa identidades, acceso, catálogo propio del cliente, precargas con agenda de ingreso y recogidas con alistamientos. Los clientes crean productos Bodega y lotes automáticamente mediante las API existentes de WMS. El personal interno confirma la recepción física.

## Arquitectura

```text
src/
  config/                 # env.js y conexión Sequelize en db.js
  models/                 # Registro de modelos y asociaciones existentes
  modules/
    usuarios/
      usuario.model.js
      usuario.service.js
      usuario.controller.js
      usuario.routes.js
    clientes/             # Mismo patrón
    sesiones/             # Mismo patrón
    auth/                 # Login y cambio de contraseña; usa Usuario/Sesion
    actores/              # Modelo y servicio internos
    dispositivos/         # Modelo y servicio internos
    auditoria/            # Modelo y servicio internos
    salud/                # Servicio, controlador y rutas, sin tabla propia
    terminos/             # Versiones publicadas y aceptaciones individuales
    productos/            # Maestra, versiones y relación con el cliente
    precargas/            # Solicitud de lote, revisión inmutable e idempotencia
  middlewares/            # JWT WMS, sesión, CSRF, contexto y validación
  integrations/wms/       # Cliente HTTP WMS, únicamente GET en este bloque
  routes/                 # Montaje de rutas
  utils/                  # Criptografía, cookies, errores y respuestas
  app.js                  # Configuración HTTP y montaje
  server.js               # Arranque y cierre de conexiones
```

Flujo: **route → middleware → controller → service → model Sequelize → MariaDB**. Los controladores solo adaptan HTTP; los servicios aplican reglas y coordinan transacciones del ORM. Los 18 modelos reflejan tablas del esquema existente. Las relaciones compuestas permanecen en la base existente. No se exponen endpoints de administración para tablas de soporte que no los necesitan.

La configuración y los secretos siguen en `.env`. El ORM no ejecuta `sync`, `alter` ni migraciones al iniciar. SQL manual solo se utiliza para inspeccionar metadatos del esquema y preparar fixtures aislados de las pruebas, no para persistir operaciones de negocio.

`config/env.js` solo lee las variables de `.env` y convierte números o booleanos cuando corresponde. `config/db.js` configura la conexión Sequelize. El registro de modelos vive en `models/index.js`. El arranque comprueba la conexión; la inspección de tablas y columnas se ejecuta únicamente con `npm run db:check`.

## Ejecutar

```powershell
cd "C:\Users\tech\Desktop\Sistemas Genika\externalclientes"
npm install
npm run db:check
npm run dev
```

`npm start` ejecuta sin observador. URL local: `http://localhost:3001`. WMS se consulta en el puerto 3000.

El arranque se muestra en consola con mensajes legibles como WMS: `📌 Iniciando externalclientes con Node.js…`, `✅ Modelo… cargado correctamente`, `✅ Conexión a la base de datos externalclientes establecida.`, `✅ Módulo… cargado correctamente`, confirmación de rutas y `🚀 Servidor corriendo en http://host:puerto`. La dirección y puerto corresponden a la escucha real. Registrar modelos no comprueba que todas sus tablas existan: la inspección del esquema se mantiene en `npm run db:check`. El servidor solo empieza a escuchar después de autenticar la conexión y construir la aplicación. No ejecuta `sync`, `alter` ni modificaciones del esquema.

La versión de Node está fijada en `.node-version`, `.nvmrc` y `package.json`. En este equipo está instalada mediante nvm-windows en paralelo con la versión de WMS. Los comandos `npm run dev`, `npm start`, `npm test`, `npm run test:integration` y `npm run db:check` seleccionan automáticamente Node 24.22.0 mediante `scripts/node.js`, sin cambiar el selector global de nvm. Comprobar con `npm run node -- --version`. El lanzador no interviene en las peticiones HTTP.

Para instalar dependencias con el mismo runtime en una terminal PowerShell, ejecutar `$env:Path = "$env:NVM_HOME\v24.22.0;$env:Path"` antes de `npm install`. Este ajuste solo afecta esa terminal. En otro equipo Windows con nvm, instalar primero `nvm install 24.22.0`. Si Node 24.22.0 ya está activo, el lanzador usa el ejecutable actual directamente.

La configuración real está en `.env`, excluido de Git. No hay `.env.example`. Las claves no tienen valores de respaldo en el código. No copiar `.env` a tickets, repositorios o respuestas de API. Conservar el pepper de contraseñas; cambiarlo exige restablecer las credenciales afectadas. Las claves de sesión y CSRF también invalidan sesiones al rotarlas.

La configuración suministrada usa las credenciales locales solicitadas y HTTP en loopback. Para un despliegue HTTPS se ajustan `PUBLIC_BASE_URL`, `CORS_ALLOWED_ORIGINS`, `HOST`, proxy confiable y `COOKIE_SECURE=true`. No existen migraciones ni `sync/alter` automáticos. `database/001-inicial.sql` es la copia del esquema inicial, no debe reimportarse sobre la base existente.

`database/002-terminos.sql` agrega dos tablas de términos y cinco claves foráneas. Se aplica una sola vez después del esquema inicial: no reemplaza tablas existentes ni publica documentos. La instalación completa contiene 33 tablas y 74 claves foráneas. Para una instalación nueva, importar 001 y después 002.

## Autorización interna

Genika envía `Authorization: Bearer <JWT emitido por WMS>`. Se validan firma HS256 con `WMS_JWT_SECRET`, vencimiento, identidad/personal, cambio de clave pendiente y `permisos.esAdmin === true`. No hay otra lista de empleados ni otra tabla de permisos internos. No se fabrican JWT WMS. Las rutas administrativas usan el JWT del operador; las llamadas automáticas a catálogo y lotes usan la credencial de servicio exclusivamente desde el backend.

WMS puede incluir `permisos` como objeto o como texto JSON procedente de MariaDB. externalclientes interpreta ese texto una sola vez después de verificar la firma y sigue exigiendo el booleano `esAdmin: true`; texto malformado, arreglos, permisos ausentes y valores como `"true"` o `1` se rechazan.

Las facultades son las incluidas en el JWT firmado: los cambios de estado o permisos posteriores en WMS requieren renovar o vencer ese token para reflejarse aquí. No se consulta `/auth/me` para esta autorización. Este comportamiento sigue la decisión de validar el JWT de WMS sin modificar dicha API.

Las consultas del conector usan únicamente GET. Al crear acceso se verifica que el cliente exista y esté activo en WMS; la respuesta pública se reduce a ID, nombre y activo, descartando documentación y datos internos. Los clientes no se crean en WMS. No se escribe directamente en sus tablas.

Genika consulta `GET /api/interno/clientes?page=1&limit=25` en externalclientes. Esta ruta consume el listado existente de WMS y devuelve clientes activos con su mismo `wms_cliente_id`. Al seleccionar uno, ese ID se envía en el alta del usuario; el servidor vuelve a comprobar ese cliente antes de guardar el vínculo. `total_wms` corresponde al total original de WMS, incluidos los inactivos; `has_more` permite recorrer todas las páginas aunque una página no tenga clientes activos. Estas llamadas son consultas de clientes: la autorización del JWT se resuelve localmente y no hace peticiones HTTP de autenticación.

## Rutas iniciales

| Método | Ruta | Acceso |
|---|---|---|
| GET | `/health` | Estado del proceso |
| GET | `/ready` | Conexión a la base propia |
| GET | `/api/interno/me` | JWT WMS administrador |
| GET | `/api/interno/clientes?page=1&limit=25` | JWT WMS administrador; listado de clientes activos WMS |
| GET | `/api/interno/clientes/:wmsId/validacion` | JWT WMS administrador |
| GET | `/api/interno/usuarios?cliente_id=1&page=1&limit=25` | JWT WMS administrador |
| POST | `/api/interno/usuarios` | JWT WMS administrador |
| PATCH | `/api/interno/usuarios/:id/estado` | JWT WMS administrador |
| POST | `/api/interno/usuarios/:id/password-temporal` | JWT WMS administrador |
| PATCH | `/api/interno/clientes/:id/habilitacion` | JWT WMS administrador |
| POST | `/api/interno/terminos` | JWT WMS administrador; publica una versión nueva |
| GET | `/api/terminos` | Público; documento publicado, sin datos de usuarios |
| POST | `/api/auth/login` | Credenciales externas |
| GET | `/api/auth/me` | Cookie de sesión y navegador |
| POST | `/api/auth/password` | Cookie + `X-CSRF-Token` |
| POST | `/api/auth/logout` | Cookie + `X-CSRF-Token` cuando hay sesión |
| GET | `/api/auth/terminos` | Sesión externa; texto y estado de aceptación individual |
| POST | `/api/auth/terminos/aceptacion` | Contraseña cambiada + sesión + `X-CSRF-Token` |
| GET | `/api/auth/sesiones` | Sesión NORMAL y términos aceptados |
| DELETE | `/api/auth/sesiones/:id` | Sesión NORMAL, términos aceptados y `X-CSRF-Token` |
| GET | `/api/productos?page=1&limit=25` | Sesión NORMAL y términos vigentes; catálogo de la propia empresa |
| POST | `/api/productos` | SOLICITANTE, sesión NORMAL, términos y CSRF |
| GET | `/api/productos/catalogo` | Sesión NORMAL y términos vigentes; presentaciones, tipos y unidades |
| GET | `/api/precargas?page=1&limit=25` | Sesión NORMAL y términos vigentes; solicitudes de la propia empresa |
| POST | `/api/precargas` | SOLICITANTE, sesión NORMAL, términos y CSRF; envío idempotente |

Alta: `{ "wms_cliente_id": "ID real WMS", "username": "usuario.cliente", "correo": "correo del cliente", "perfil": "SOLICITANTE" }`. `perfil` también admite `CONSULTA`; ninguno puede administrar accesos. El servidor genera la contraseña temporal y solo la entrega en esa respuesta administrativa. Ni la contraseña ni su hash aparecen en los listados.

Login: `{ "username": "usuario.cliente", "password": "contraseña recibida", "nombre_dispositivo": "Mi navegador" }`. El secreto de sesión se entrega en cookie HttpOnly, nunca como JWT ni como JSON. El servidor persiste hashes de identificadores de sesión/dispositivo y un hash scrypt con sal y pepper para la contraseña. No hay registro público.

Primer login: sesión PROVISIONAL. Solo puede consultar su contexto y términos, cambiar contraseña o salir. Cambio: `{ "password_actual": "temporal", "password_nueva": "contraseña elegida" }` con el `csrf_token` devuelto por login o `/api/auth/me` en `X-CSRF-Token`. Esto revoca las sesiones anteriores y crea una NORMAL. Contraseñas de 12 a 128 caracteres, sin truncar Unicode. Aun con sesión NORMAL, necesita aceptar los términos vigentes para operar.

## Primer ingreso y términos

Flujo del front: iniciar sesión → cambiar contraseña temporal → consultar términos → mostrar dos casillas desmarcadas → confirmar ambas → habilitar operaciones. `login`, cambio de contraseña y `/api/auth/me` devuelven `terminos` y `habilitado_para_operar`. Una sesión NORMAL indica que ya cambió la contraseña; el front debe usar `habilitado_para_operar` para decidir si puede continuar. La API aplica el bloqueo con `middleware.normal`; las futuras rutas operativas deben usar ese middleware además de autenticación y permisos propios.

La consulta pública `GET /api/terminos` permite mostrar el documento antes de login. `GET /api/auth/terminos` añade la aceptación del usuario actual. El texto se entrega como texto plano y el front debe renderizarlo como texto, sin `innerHTML`. El cliente puede consultar el texto, su contexto y cerrar sesión mientras esté pendiente la aceptación.

Enviar a `POST /api/auth/terminos/aceptacion`:

```json
{
  "version": "versión recibida al consultar",
  "contenido_sha256": "huella recibida al consultar",
  "acepto": true,
  "autoriza_tratamiento_datos": true
}
```

No se reciben IDs de usuario, cliente, sesión ni dispositivo en ese cuerpo: se toman de la sesión autenticada. Los booleanos deben ser `true`, no cadenas. Se exige CSRF y correspondencia exacta de versión y huella. La evidencia conserva usuario, empresa, sesión, dispositivo, IP, navegador, correlación y fecha UTC; se interpreta con `America/Bogota` al mostrarla. Las repeticiones conservan una única aceptación y su fecha original. La aceptación de otro usuario, aunque pertenezca a la misma empresa, no habilita la propia.

Publicación interna: `POST /api/interno/terminos` con `{ "version": "1.0", "titulo": "Términos de Clients Fastway", "contenido": "Texto completo aprobado" }`. Publicar crea una versión inmutable; no hay edición ni eliminación por API. La vigente es la última por ID. Una versión nueva exige nueva aceptación incluso en sesiones abiertas. Sin documento publicado se permite iniciar sesión, cambiar contraseña y salir, pero no operar (`TERMINOS_NO_PUBLICADOS`). Un documento pendiente produce `TERMINOS_REQUERIDOS`; una versión o huella desactualizada al aceptar produce `TERMINOS_CAMBIARON` (409).

El contenido admite párrafos y hasta 12000 caracteres, sujeto al límite HTTP de 16 KiB de JSON. No debe contener los marcadores `[PENDIENTE ...]`. `legal/terminos-borrador.txt` contiene una propuesta para fastwaysas, NIT suministrado 900756702, con datos de contacto y política pendientes. No se publica automáticamente ni se guarda como aceptación. Completar los datos y revisar jurídicamente el texto y la política antes de publicarlos. Los términos de uso y la autorización de tratamiento se confirman por separado; no se incluye consentimiento publicitario. La aceptación del primer ingreso no autoriza retroactivamente datos recogidos al crear la cuenta: Innovación debe informar y verificar la base jurídica correspondiente antes del alta.

El front debe enviar `credentials: 'include'` y conservar el CSRF en memoria. Sesión y navegador se comprueban juntos. Consultar o revocar otra sesión siempre exige el mismo usuario y cliente. Suspender/restablecer revoca sesiones; reactivar no revive las anteriores. No permitir llamadas del front cliente con el JWT interno de WMS.

`estado` para usuario admite ACTIVO/SUSPENDIDO; `habilitado` para empresa es booleano. Rehabilitar empresa comprueba de nuevo WMS. Crear una cuenta no rehabilita una empresa suspendida. El estado activo WMS guardado en el vínculo es la última validación: este bloque no implementa todavía sincronización automática de bajas WMS.

Toda alta, cambio de credenciales/estado y gestión de sesiones registra actor, IP, contexto de navegador, sesión cuando existe, correlación y hora UTC. Se muestra en Colombia usando `America/Bogota` en el front. El dispositivo registrado identifica contexto de navegador, no hardware verificable.

## Validación y protección de endpoints

Orden HTTP: contexto y correlación → log de acceso → límite por IP → validación de URL, cabeceras y método → origen/CORS → JSON con límite y UTF-8 válido → límites de estructura → autenticación y permisos → esquema de la ruta → controller/service/model → manejador de errores.

Cada ruta declara sus campos permitidos, tipos, obligatoriedad, longitudes y valores válidos. Los listados solo admiten los filtros declarados; `page` y `limit` deben ser enteros decimales positivos, con máximos de 100000 y 100. Los IDs locales deben ser enteros positivos representados como cadenas. Los IDs remotos admiten letras ASCII, números, punto, guion y guion bajo, con longitud máxima de 250. No se aceptan objetos donde corresponde texto, booleanos como cadenas, parámetros repetidos ni operadores del cliente.

Se bloquean claves `__proto__`, `constructor`, `prototype`, claves con puntos o corchetes y claves que empiecen por `$`. Hay límites de tamaño del cuerpo, profundidad y cantidad de claves; la API acepta JSON sin compresión y rechaza cuerpos en GET/HEAD/OPTIONS. Las cabeceras de autenticación, origen, CSRF, tipo de contenido y Host no pueden repetirse. Los límites HTTP del servidor controlan cabeceras, tiempo de recepción, inactividad y reutilización de conexiones.

La prevención de SQL injection conserva consultas ORM con campos y orden definidos en el servidor; no se reciben `where`, nombres de columnas, SQL ni orden arbitrario. La validación no reemplaza el aislamiento por cliente ni las transacciones. No se ejecutan comandos de sistema ni se construyen consultas SQL a partir de datos enviados por clientes. Las contraseñas conservan exactamente sus caracteres Unicode; no se recortan ni se eliminan comillas. El texto legal conserva sus párrafos para que su huella represente el contenido exacto. La API entrega texto en JSON: el front debe renderizarlo como texto y evitar `innerHTML` con datos del cliente.

El límite por IP se aplica antes de leer JSON, y login/cambio de contraseña tienen su propio límite adicional. Los intentos fallidos por cuenta y la revocación de sesiones siguen persistidos en la base. Un tope de hashes simultáneos limita el consumo de scrypt: si se alcanza, responde 503 `AUTENTICACION_OCUPADA` con `Retry-After`. El límite por IP actual vive en memoria de un proceso: se reinicia al reiniciar Node y no se comparte entre réplicas. Un despliegue con varias instancias necesita un almacén compartido o límites en el gateway; el gateway también debe cubrir rotación de IP, IPv6 y ataques distribuidos.

El conector de WMS sigue haciendo solo GET, con URL base fija, ID validado, timeout y rechazo de redirecciones. Limita tanto respuestas con `Content-Length` como respuestas por fragmentos y comprueba el esquema de clientes antes de utilizar datos externos.

## Logs y errores

`docs/log-ejemplo.json` muestra la plantilla. Los eventos de peticiones y errores se escriben como líneas JSON en stdout con fecha UTC, nivel, servicio, ambiente y evento. Los mensajes informativos de arranque y cierre del servidor se muestran como texto legible con iconos. Las peticiones incluyen correlación, método, plantilla de ruta, estado y duración; se añaden IDs internos de usuario/cliente/sesión cuando están autenticados. `sesion_id` es el ID de la fila, nunca el secreto de la cookie. Para Colombia se convierte `fecha_utc` usando `America/Bogota`.

`HTTP_COMPLETADA` registra el resultado de una petición y `HTTP_ABORTADA` una conexión interrumpida. `HTTP_ERROR` añade el código funcional y una clasificación segura del error. Un error HTTP produce tanto su evento de error como el de finalización: se relacionan por `correlation_id`. Los fallos anteriores al parser Express se registran como `HTTP_PROTOCOLO_RECHAZADO`. Una petición que falla antes de identificar una ruta registra `SIN_RUTA`, sin copiar su URL original. El servidor genera la correlación y no acepta la suministrada por el cliente.

El logger acepta una lista cerrada de campos y elimina caracteres de control para impedir inyección de líneas. No registra cuerpos, queries, cabeceras, nombres de usuario, correos, contraseñas, JWT, cookies, CSRF, documentos, SQL, configuración, mensajes de excepción o stacks. Los errores de proceso no controlados se registran con clasificación segura y terminan el proceso con código 1; requieren un supervisor para reiniciar. Los errores operativos de petición reciben una respuesta JSON uniforme con `error.code`, `error.message` y `correlation_id`, sin detalles del driver. Los errores de escucha/arranque usan el mismo logger.

Los logs técnicos van a stdout para capturarlos con el servicio o recolector del despliegue; la auditoría funcional permanece en MariaDB. Esta versión no instala un recolector ni implementa rotación o retención de archivos. El recolector debe persistir los logs con acceso restringido y una retención definida, porque incluyen IP e identificadores. `LOG_LEVEL=info` conserva accesos, errores y rechazos de seguridad.

Todas las nuevas opciones están en `.env`: `HTTP_BODY_LIMIT_BYTES` (16384), `HTTP_MAX_URL_LENGTH` (2048), `HTTP_JSON_MAX_DEPTH` (8), `HTTP_JSON_MAX_KEYS` (128), `HTTP_QUERY_MAX_KEYS` (8), timeouts y límites `HTTP_*`, `AUTH_MAX_CONCURRENT_HASHES` (4), `WMS_RESPONSE_MAX_BYTES` (1048576) y `LOG_LEVEL`. Las claves y secretos siguen exclusivamente en `.env`.

## Condiciones pendientes para exposición pública

Este entorno continúa siendo local. No está aprobado para publicarse solo por pasar las pruebas. La clave JWT compartida suministrada para WMS necesita reemplazarse por un secreto criptográfico fuerte antes de exponer rutas administrativas; eso exige coordinar la rotación con WMS y renovar sus tokens. No se cambió esa clave ni ningún archivo de WMS: sigue vigente la instrucción de pedir autorización antes de modificar otra API.

externalclientes usa Node 24.22.0 LTS. La actualización se realizó solo para este proyecto; no se cambiaron WMS, sus archivos ni el selector global de Node. `npm audit` revisa dependencias npm, no certifica la seguridad del runtime.

El despliegue también requiere HTTPS con cookies Secure, dominios CORS reales, proxy confiable configurado según la topología y bloqueo de acceso directo al puerto de Node cuando se usa proxy. La aplicación debe usar una cuenta MariaDB propia con los permisos mínimos sobre externalclientes, no root ni acceso a las tablas de WMS. Los puertos de MariaDB y WMS deben permanecer privados. Son decisiones de despliegue pendientes; no se modificaron credenciales o servicios existentes.

Criterios utilizados: [OWASP Input Validation](https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html), [OWASP SQL Injection Prevention](https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet), [OWASP Logging](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html), [Express: seguridad en producción](https://expressjs.com/en/advanced/best-practice-security/) y [Node.js: versiones fuera de soporte](https://nodejs.org/en/about/eol).

## Verificación

`npm run test:operations` verifica productos y precargas con Sequelize y una base temporal `externalclientes_ops_test_<nonce>`, que elimina al finalizar. Ejecuta los routers Express directamente, sin iniciar servidores. Comprueba aislamiento por cliente, permisos y CSRF, transacciones, precisión decimal, versiones inmutables, auditoría y deduplicación concurrente. No llama al WMS ni agrega datos a la base real.

## Catálogo y precargas de mercancía

Cada producto se crea en una transacción con identificadores técnicos generados, presentación por prefijo, ficha PROPUESTA y relación PENDIENTE con el cliente de la sesión. El cliente no asigna códigos. El código definitivo se consulta desde `producto_equivalencia_wms` para la versión vinculada a Genika; sin equivalencia devuelve `codigo_wms:null`. El servidor calcula el consecutivo según los prefijos activos de WMS, crea o reutiliza la ficha y confirma la equivalencia sin aprobación humana; el navegador no asigna consecutivos.

`GET /api/productos/catalogo` devuelve presentaciones Bodega y RS de la copia local `src/modules/productos/catalogo-genika.json`, tipos Bodega/RS y unidades unidades/kilos/pallet. Las presentaciones están filtradas en el front según tipo y el servidor valida esa correspondencia. La copia no se sincroniza automáticamente con cambios futuros en WMS. El POST requiere `request_id,prefijo,nombre,referencia,tipo,unidad_medida,alto_cm,ancho_cm,largo_cm`; rechaza códigos impuestos por el cliente. `request_id` hace idempotente el guardado mediante comandos_idempotentes, también ante concurrencia. Los códigos técnicos se conservan en la base sin mostrarlos como códigos Genika.

`database/003-producto-prefijo.sql` agrega `producto_versiones.prefijo`, nullable para conservar las fichas anteriores. El cambio ya fue aplicado en la base local. No reinterpreta unidades ni códigos previos y no ejecuta modificaciones en WMS. Nuevas instalaciones deben importar 001, 002 y 003. La instalación continúa con 33 tablas y 74 claves foráneas.

La ficha se habilita automáticamente cuando se confirma su creación o reutilización en WMS; no requiere aprobación manual. Una ficha pendiente de sincronización no puede incluirse en un lote. CONSULTA puede leer y SOLICITANTE también puede crear. Las escrituras vuelven a comprobar sesión, permisos y términos dentro de la transacción.

Una precarga contiene una referencia propia de la carga, referencias opcionales de contenedor/transporte, observaciones y hasta 25 productos distintos. El cliente declara la mercancía y externalclientes crea automáticamente el lote y sus líneas en Genika, devolviendo su identificador real. El campo de entrada `referencia_lote` conserva su nombre por compatibilidad y representa la referencia del cliente, no el número de lote. El GET devuelve `wms_lote_id` por separado: null mientras no exista un vínculo confirmado en `precarga_lotes`. Si el resultado remoto no puede confirmarse, se conserva el registro y se verifica el mismo intento sin repetir escrituras inciertas.

Las cantidades declaradas son decimales positivos enviados como texto. Solo se aceptan vínculos HABILITADO de la empresa autenticada y versiones HOMOLOGADA con una equivalencia WMS confirmada. Estos estados técnicos representan sincronización; no requieren revisión humana. El servidor verifica la versión esperada del producto y fija la pertenencia, el estado ENVIADA, la revisión, el actor y la evidencia de sesión/dispositivo. El cliente no puede asignar un `wms_lote_id` mediante el POST.

`request_id` es un UUID v4 generado al revisar el formulario. Reintentar con la misma clave, actor, empresa y contenido devuelve el resultado original. Reutilizar esa clave con otro contenido devuelve 409. El comando y la solicitud se confirman juntos; un fallo revierte todos los registros. El campo `expira_at` del comando se fija a 24 horas; este bloque no elimina comandos vencidos y sigue reconociendo sus claves mientras existan.

La primera revisión conserva una instantánea de las fichas y cantidades enviadas y su SHA-256. Cambios posteriores del catálogo no modifican esa declaración. Cada envío registra actor, sesión, dispositivo, IP, navegador y fecha UTC, mostrada en Colombia en Clients Fastway.

Las precargas crean lotes y sus líneas en WMS, sin generar inventario. Las herramientas de revisión interna se conservan para fichas anteriores y conciliación. El contrato de campos del portal está en `FrontClientes/docs/productos-precargas.md`.

### Inventario real del cliente

La vista consolidada del portal usa `GET /api/inventario/productos`: agrupa todos los saldos positivos por código y unidad antes de filtrar y paginar. Admite buscar por campo (todos/producto/codigo/referencia/lote), unidad exacta, distribución (todos/uno/varios) y orden por nombre, cantidad ascendente/descendente o movimiento reciente. Devuelve totales decimales exactos, cantidad de lotes y unidades disponibles. Buscar un lote mantiene el total completo del producto. `GET /api/inventario/productos/:codigo/lotes?unidad=...` permite buscar y paginar los lotes de ese grupo, con nueva comprobación de pertenencia y saldo. Las dos consultas usan la misma sesión y términos del portal, no reciben un cliente elegido desde el navegador ni requieren migraciones o cambios en WMS. El endpoint anterior por lote se conserva para alistamientos.

`GET /api/inventario?page=1&limit=25` requiere sesión NORMAL, cliente habilitado y términos vigentes. Ambos perfiles pueden leer. No acepta identificadores de cliente aportados por el navegador: obtiene la empresa WMS del vínculo de la sesión.

Consulta el endpoint existente `GET /api/inventario/resumen` de WMS mediante su autenticación interna existente. La clave se configura únicamente en `externalclientes/.env` como `WMS_INTERNAL_SERVICE_KEY`, usando `process.env`; no se incluye en el front ni se emiten JWT de WMS para clientes. Este mecanismo solo se usa para la consulta GET de inventario; las escrituras internas siguen usando el JWT del administrador.

El endpoint WMS actual devuelve el resumen completo al backend. La integración filtra por el ID exacto del cliente y elimina ubicaciones, bodegas, posiciones, datos de terceros y demás campos no autorizados antes de proyectar al portal. La respuesta pública agrupa producto/lote/unidad, conserva referencia externa cuando existe, usa la unidad real de WMS y suma cantidades decimales sin errores binarios. Los productos propios previos al catálogo externo también son visibles.

Campos por fila: `codigo_wms`, `wms_lote_id`, `nombre`, `referencia_cliente`, `referencia_wms`, `unidad_medida`, `cantidad_actual` como texto y `ultimo_movimiento_at`. La cabecera contiene total, page, limit y consultado_at. Cero stock no se confunde con un fallo de conexión o autenticación del servicio. No es una proyección de disponibilidad libre de reservas ni un historial de movimientos. No se copia el inventario a otra base ni se modifica WMS.

No requiere migración SQL. Se comprobó el ingreso real local con consulta de solo lectura y se prueba aislamiento entre clientes, suma decimal, errores de integración, permisos y eliminación de ubicaciones.

### Consulta de precargas en ambos portales

Las nuevas precargas requieren `fecha_programada_at` con formato `YYYY-MM-DDTHH:mm:00-05:00`. Al registrarlas se validan el horario y la anticipación configurados para operaciones, actualmente 08:00–17:00 y 300 minutos. La programación se guarda en la tabla existente `programaciones`, dentro de la misma transacción local que la declaración. El lote se crea automáticamente mediante la integración existente; el ingreso físico sigue siendo una acción de Bodega. No se crean alistamientos para los ingresos.

`GET /api/precargas` incluye `anticipacion_minutos`, `horario_operacion` y la fecha de cada precarga. `GET /api/operaciones`, `/api/interno/operaciones` y `/api/interno/programacion-bodega` muestran ingresos y recogidas, con `tipo_operacion: INGRESO | RECOGIDA`, sus fechas y referencias reales. El estado de recepción se obtiene de WMS. Las precargas anteriores sin programación permanecen consultables en su listado, pero no se inventa una fecha para incluirlas en la agenda. Este flujo usa las tablas existentes y no requiere migraciones ni cambios en WMS.

Clients Fastway consulta `GET /api/precargas` y `GET /api/precargas/:public_id`, con sesión, términos vigentes y aislamiento por empresa. Genika consulta `GET /api/interno/precargas?page=1&limit=25&estado=TODOS` y `GET /api/interno/precargas/:public_id` con JWT WMS firmado y esAdmin. El listado interno admite filtros `estado` y `cliente_id` y no confía en identificadores de empresa aportados por el cliente externo.

El detalle obtiene productos, referencias, cantidades y observaciones de la revisión enviada, conserva los decimales como texto, y añade el código WMS vigente de esa versión y el lote confirmado si existen. Incluye comprobante, fecha y autor. No expone ubicaciones, sesiones, dispositivos ni detalles internos de auditoría al portal del cliente. Una precarga ajena devuelve 404.

Las pantallas son `/precargas` en Clients Fastway y `/precargas-clientes` en Genika. Revisar el formulario no lo persiste: se guarda al confirmar Registrar precarga y devuelve un comprobante. El lote se crea al registrar la precarga. El detalle de ambos portales permite verificar una creación pendiente.

`POST /api/interno/precargas/:public_id/crear-lote` recibe exclusivamente `{revision:1}` y exige JWT WMS firmado con esAdmin. Es una recuperación técnica; no es una aprobación. El cliente dispone de `POST /api/precargas/:public_id/crear-lote` con sesión SOLICITANTE, términos, CSRF y pertenencia. El servidor valida revisión, estado ENVIADA, cliente activo y productos homologados con equivalencia WMS. Calcula el siguiente GEN_, crea lote y líneas mediante los endpoints existentes, y verifica código, marcador de precarga, cliente y cantidades. No registra entradas físicas ni stock.

Comando APROBAR_PRECARGA_WMS por solicitud/revisión: persiste plan, avance y resultado antes/después de cada envío, sin tokens. Las solicitudes repetidas verifican el mismo intento. Los POST inciertos no se repiten; las líneas aún no enviadas sí pueden continuar. Un consecutivo ocupado antes de enviar líneas permite recalcular en un intento explícito. Las discrepancias posteriores requieren conciliación. Mantener comandos en curso aunque venza su fecha nominal.

Al confirmar todas las líneas, una transacción guarda el lote real y registra auditoría con actor, sesión, dispositivo y fecha. La solicitud conserva ENVIADA y se muestra como Lote creado cuando tiene vínculo; no se genera una decisión de aprobación. Las decisiones anteriores se conservan como historial. Un fallo local revierte esos cambios y permite recuperar el resultado remoto sin duplicados. Los GET de ambos portales proyectan aprobación, lote y avance mientras se concilia. El flujo de lotes usa tablas existentes y no cambia código en wmsBack; el catálogo compartido requiere la migración 004 descrita más abajo.

Se conservan referencias distintas entre cliente y Genika. Importar cantidades exige la misma unidad y precisión representable en WMS; no hay conversiones automáticas. Las fechas del lote se envían nulas porque el formulario todavía no las captura. Los códigos de líneas LP los genera WMS; si hay una respuesta incierta ausente o discrepante, se informa para conciliación.

### Herramientas internas para fichas anteriores en Genika

`GET /api/interno/productos?page=1&limit=25&estado=PENDIENTE` lista fichas de clientes con empresa, autor, fecha y estado de integración. Acepta filtro `cliente_id` y estados PENDIENTE/HABILITADO/DESHABILITADO/TODOS.

`GET /api/interno/productos/wms?buscar=texto&prefijo=YUT` consulta la maestra WMS y devuelve hasta 100 resultados filtrados. Solo está disponible para personal interno con JWT WMS firmado y `esAdmin`.

`POST /api/interno/productos/:id/aprobar` recibe `{producto_version_id,modo:'CREAR'}` o `{producto_version_id,modo:'VINCULAR',wms_producto_id}`. No permite asignar actor, cliente ni un código manual para crear. Comprueba versión vigente y cliente habilitado. El front ofrece este flujo en `/productos-clientes`.

CREAR verifica el prefijo activo en WMS, calcula su siguiente consecutivo y persiste un comando APROBAR_PRODUCTO_WMS por versión antes del envío. Usa el POST de productos existente en WMS con el JWT recibido, sin guardar el token. Después consulta la ficha y comprueba nombre, referencia, prefijo, tipo, unidad y dimensiones para confirmar el resultado de esa creación.

VINCULAR permite fichas distintas: el administrador confirma la equivalencia con un producto existente. Se conservan los datos y la referencia externa del cliente y los internos de WMS; no realiza POST ni edita WMS, ni convierte unidades o cantidades. La auditoría conserva el modo y la ficha WMS confirmada. Las restricciones de permisos, versión, cliente habilitado y equivalencia ocupada siguen vigentes. Un intento de creación ENVIADO debe conciliarse primero y conserva la verificación exacta de su resultado; no puede eludirse cambiando a VINCULAR.

Una transacción local guarda la equivalencia, marca versión HOMOLOGADA, producto VALIDADO y vínculo HABILITADO, y registra revisor, fecha y auditoría. El GET del cliente ya devuelve el código real. No modifica la declaración de precargas anteriores ni registra cantidades de inventario.

Los comandos en curso se conservan para conciliación, incluso tras su fecha nominal de expiración; no deben purgarse automáticamente. Una respuesta perdida o un fallo local después del envío se recuperan consultando el mismo código sin repetir el POST. Si el código tiene otra ficha, el intento se marca COLISION y el siguiente intento explícito calcula otro. Un resultado ausente sigue como WMS_CONFIRMACION_PENDIENTE: requiere conciliar el intento, porque WMS no tiene un contrato de idempotencia para reenviarlo con seguridad.

El esquema actual impide vincular un mismo código WMS a dos versiones externas diferentes. Se informa CODIGO_WMS_YA_VINCULADO para revisar la unificación de la maestra; no se mezclan fichas ni pertenencia de clientes automáticamente. Este bloque no requiere SQL nuevo ni cambios de código en wmsBack, y utiliza la migración 003 de prefijos ya existente.

`npm run test:operations` verifica rutas, permisos, aislamiento, transacciones, concurrencia y recuperación con MariaDB temporal y un WMS simulado; no inicia servidores ni modifica la base del usuario.

```powershell
npm test
npm run test:integration
```

Las pruebas de integración crean y eliminan exclusivamente una base aleatoria `externalclientes_test_<nonce>`. Usan la conexión configurada y necesitan permiso para esas bases temporales. El doble WMS de las pruebas no llama ni escribe al WMS real. El usuario y la base externalclientes existentes no reciben fixtures. Las comprobaciones `db:check` son de solo lectura.

Para probar las rutas internas, obtener un JWT real iniciando sesión normalmente en WMS y enviarlo en Authorization. No hay cuentas reales ni contraseñas de prueba incluidas en el proyecto.

Referencias de seguridad utilizadas: [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) y [crypto.scrypt de Node 24](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback).


### Catálogo Bodega y creación directa (2026-10-20)

- `GET /api/productos/bodega?page=1&limit=25&buscar=...`: todas las fichas Bodega, sin clientes, ubicaciones ni existencias de terceros.
- `GET /api/productos/similares?nombre=...&referencia=...`: hasta ocho coincidencias, comparando también presentación, unidad y dimensiones cuando se proporcionan. Consulta al escribir con espera de 350 ms y cancelación de respuestas obsoletas.
- `POST /api/productos/vincular` con `{codigo_wms}`: añade una ficha Bodega existente al catálogo de la empresa autenticada. Repetir la acción no duplica la relación ni edita WMS.
- `POST /api/productos`: vuelve a comparar en servidor al guardar. Una ficha idéntica se reutiliza; una parecida requiere `confirmar_diferente:true`. Se crea directamente en WMS y se habilita al confirmar el resultado.
- `POST /api/productos/:id/confirmar` con `{}`: recupera una creación propia pendiente, sin aprobación manual ni repetición ciega de un POST incierto.

La clave estable de maestra evita dos creaciones locales idénticas concurrentes. Las referencias anteriores se conservan. `database/004-catalogo-bodega-compartido.sql`, ya aplicado en la base local, sustituye la unicidad global del código WMS por un índice de consulta: distintas fichas externas pueden reutilizar un mismo código, manteniendo una sola equivalencia por versión. No borra filas ni modifica wmsBack.

La integración usa la credencial de servicio de `.env` exclusivamente en servidor, con operaciones permitidas explícitas: leer catálogo/cliente/lotes, crear producto Bodega, crear lote y sus líneas. No confirma entradas ni modifica inventario. Las escrituras de catálogo y lotes mantienen perfil SOLICITANTE, sesión vigente, aceptación de términos, CSRF y auditoría.


### Retirar un producto de Mi catálogo

`DELETE /api/productos/:id` retira únicamente la relación del cliente autenticado, con perfil SOLICITANTE, CSRF y términos vigentes. Antes de retirarla consulta el inventario completo de esa empresa en WMS y compara los códigos de todas las versiones de la ficha. Cualquier saldo no nulo en cualquier lote bloquea la retirada con `PRODUCTO_CON_EXISTENCIAS`; un error de WMS impide el cambio. No se borran la maestra, equivalencias, productos WMS, precargas ni movimientos.

`database/005-retiro-catalogo-cliente.sql`, aplicada en la base local, añade `cliente_producto.retirado_at`. El listado y la selección para nuevas precargas excluyen relaciones retiradas. Una asociación explícita desde Productos Bodega recupera la misma relación, sin duplicar el producto ni el vínculo; no evita los bloqueos administrativos existentes. Los reintentos de retirada son idempotentes y la auditoría guarda actor, sesión, dispositivo, fecha e IP.

`GET /api/inventario` admite `buscar` por código, nombre, referencias y lote. La búsqueda ignora mayúsculas y tildes y se aplica antes de paginar, manteniendo el aislamiento de la empresa autenticada.

### Operaciones y alistamientos directos

Clients Fastway usa `/operaciones` para agendar una recogida en bodega y crear inmediatamente el alistamiento en Genika. El cliente programa la llegada de su vehículo y selecciona mercancía para que Fastway la aliste y cargue en el camión. El alta ya no ofrece entrega a domicilio. `/agenda` y `/alistamientos` redirigen al mismo módulo. El formulario selecciona únicamente existencias de la empresa autenticada por producto/lote; nunca solicita ubicaciones. La fecha se introduce en hora de Colombia y se conserva en UTC. `OPERACION_ANTICIPACION_MINUTOS=300` en `.env` exige cinco horas entre registrar una solicitud nueva y su recogida programada. Se persisten el instante de validación y el anticipo aplicado; los reintentos conservan esa referencia y una programación cuyo horario ya venció no se envía por primera vez a WMS. Las solicitudes anteriores conservan su regla registrada.

La bandeja de Genika usa `GET /api/interno/operaciones?page=1&limit=25&buscar=...` y `GET /api/interno/operaciones/:public_id`. Solo admiten JWT WMS firmado con `gestionBodega` o `esAdmin`; las demás rutas de administración siguen exigiendo `esAdmin`. La búsqueda por nombre de operación, empresa o identificación se aplica en ORM antes de paginar. Los estados se consultan mediante los endpoints de WMS existentes y no se inventan si WMS está fuera de línea. El listado devuelve resúmenes y el detalle conserva la solicitud original, su solicitante y sus productos. No hay migración ni cambios en WMS para esta bandeja; FrontWms reutiliza su PATCH de preparación existente. La regla de cinco horas valida el horario solicitado; los movimientos físicos siguen sujetos al proceso interno de salida de WMS.

El horario de llegada se configura con `OPERACION_HORA_INICIO=08:00` y `OPERACION_HORA_FIN=17:00` en `.env`, en hora de Colombia. El listado del cliente entrega `horario_operacion` con inicio, fin y zona horaria para construir el selector. La API rechaza llegadas anteriores a las 08:00 o posteriores a las 17:00 con `HORARIO_NO_PERMITIDO`, antes de consultar inventario o crear solicitudes; las 17:00 exactas están permitidas. También comprueba el horario antes del primer envío pendiente a WMS. No se modifican alistamientos ya creados en WMS. La anticipación sigue siendo de cinco horas transcurridas, y el formulario ofrece solo minutos que cumplen simultáneamente ambas reglas; si no queda horario ese día, propone el siguiente a las 08:00. No se añadieron restricciones de días de semana o festivos.

`GET /api/operaciones` y `GET /api/operaciones/:public_id` permiten consultar a SOLICITANTE y CONSULTA. `POST /api/operaciones` y `POST /api/operaciones/:public_id/confirmar` exigen SOLICITANTE, sesión vigente, términos, CSRF y pertenencia. El navegador no aporta cliente, autor, dispositivo, estado, responsable interno ni ubicaciones. Se guardan solicitud, revisión inmutable, programación y auditoría del usuario/sesión/dispositivo/IP antes de enviar a WMS. El identificador de envío evita duplicados locales; el UUID de la solicitud hace idempotente la creación remota, incluso con respuesta perdida o rollback local posterior al alta WMS.

`database/006-operaciones.sql` añade únicamente `alistamientos.wms_alistamiento_id` y su índice único. La migración local se ejecuta con `node scripts/node.js scripts/migrate-operations.js`; ya está aplicada. No hay sincronización automática del esquema al arrancar.

WMS incorpora `POST /api/alistamientos/externos`, `GET /api/alistamientos/externos/:uuid` y consulta agrupada `GET /api/alistamientos/externos?id_cliente=...&request_ids=...`, exclusivos de la conexión de servicio autenticada. Se envía el ID real del cliente WMS, sin reutilizarlo como ID de personal. WMS comprueba cliente activo, producto Bodega, titularidad de producto/lote, cantidades y alistamientos abiertos; crea cabecera/detalles en una transacción sin movimientos de inventario. La lectura agrupada evita una llamada WMS por cada fila del listado.

WMS requiere `database/001-alistamientos-externos.sql` y `node scripts/migrate-alistamientos-externos.js`, ya aplicado localmente: permite responsable/evidencia nulos para altas externas, agrega UUID único, huella de petición, fecha programada, etapa e historial de preparación; completa las columnas de ubicaciones que ya usaba el modelo. El POST interno conserva su responsable y foto obligatorios. El servicio externo no puede marcar preparación ni confirmar salidas.

En Genika, el detalle desplegable del alistamiento permite **Iniciar preparación** y **Marcar listo para cargar** con JWT del personal. Registra usuario y fecha de cada transición. La salida continúa por el formulario existente, donde el personal selecciona posiciones y confirma el movimiento/documentos. Clients Fastway muestra Agendada, En preparación, Lista, Cancelada o Salida confirmada según WMS; si no puede consultar el estado, lo indica sin presentarlo como actualizado. La programación es una fecha solicitada; no acredita confirmación de transporte/cupo. La creación del alistamiento no reserva ni mueve stock físico: la salida vuelve a verificarlo en WMS.

Pruebas: `npm run test:operations` en externalclientes; `node --test test/alistamiento-externo.test.js` en wmsBack; `npm run test:agenda` en FrontClientes. Usan bases aisladas y navegador/API simulados, sin iniciar servidores ni crear operaciones en las bases de negocio. Esta entrega no añade edición de horarios, cancelación desde el cliente ni integración con Tareas y Proyectos; la cancelación interna existente de Genika sí se refleja en el portal.


El inventario se consulta al backend en páginas de 25 registros. La selección y sus cantidades persisten al buscar o cambiar de página. Seleccionados y el detalle del alistamiento también muestran 25 filas por página. El botón Recoger todo mi inventario recorre las páginas del backend, permite detener la consulta y prepara todas las cantidades existentes para un único envío. La selección global no envía ni confirma por sí sola. No existe un máximo de 25 ni de 400 productos por recogida; la página limita la visualización, no el alistamiento.

Solo el POST exacto /api/operaciones admite el presupuesto de recursos de OPERACION_HTTP_BODY_LIMIT_BYTES=2097152 y OPERACION_HTTP_JSON_MAX_KEYS=100000, definidos en .env. El parser mantiene JSON estricto, UTF-8, profundidad, claves peligrosas, CSRF, términos y permisos. Los demás endpoints conservan sus límites originales. No se requieren migraciones nuevas para ampliar las líneas. La API devuelve un resumen y total_productos en el listado; los detalles pertenecen a la consulta individual. WMS verifica productos, vínculos, inventario y compromisos mediante consultas por conjuntos y registra cabecera y líneas atómicamente; no realiza una consulta por cada producto.

Se verifican 400 líneas con el parser HTTP real y ORM en una base aislada, 400 líneas en WMS sin modificar existencias, y 16 páginas en navegador con conservación de cantidades, búsqueda, retirada de una selección, selección total, detalle paginado, accesibilidad y pantallas móviles. npm run test:alistamiento en FrontClientes ejecuta la prueba de 400 productos con toda la red simulada.

### Movimientos del cliente

`GET /api/movimientos?page=1&limit=25` permite consultar a SOLICITANTE y CONSULTA con sesión normal y términos aceptados. Admite `buscar` por producto, código, referencia externa/interna o lote; `tipo` (ENTRADA, SALIDA, REUBICACION, TRANSFORMACION, ALISTAMIENTO); `desde` y `hasta` como fechas YYYY-MM-DD inclusivas en Colombia. Los filtros se aplican antes de paginar y el orden es fecha descendente con desempate por ID. No admite identificadores de cliente enviados por el navegador: usa el cliente de la sesión y su vínculo WMS mediante ORM.

Flujo: FrontClientes → externalclientes → GET /api/historial/con-lote de WMS. La credencial de servicio permanece en el backend. La propiedad se verifica por lote-producto, nunca solo por código de producto, inventario actual u operación. El catálogo solo enriquece referencias; productos retirados, anteriores al portal o sin existencias actuales conservan su historial. No salen ubicaciones, posiciones, comentarios, personal, QR ni archivos internos. Las respuestas inválidas o demasiado grandes y los errores de WMS generan error, no un historial vacío. Se conserva el límite de respuesta configurado en WMS_RESPONSE_MAX_BYTES; el endpoint WMS existente devuelve el historial completo al backend antes de filtrar y paginar. No hay escrituras ni migraciones y no se modificó WMS para esta consulta.

`npm run test:movements` verifica titularidad, DTO, fechas, filtros, paginación, permisos y sesiones con pruebas en memoria y una base MariaDB aislada. No inicia servidores ni modifica las bases de negocio.

### Documentos de la empresa

Este módulo corresponde al expediente del cliente: RUT, Cámara de Comercio, certificación bancaria, cédula y otros soportes habilitados en `src/modules/documentos/documento.catalog.js`. No corresponde a remisiones de ingreso/salida ni expone revisiones internas de listas o visitas de seguridad. Consulta, carga y actualiza documentos en el almacenamiento existente de WMS; no crea tablas, no guarda copias de archivos en externalclientes y no ofrece DELETE.

- `GET /api/documentos?page=1&limit=25`: lista documentos existentes de la empresa autenticada, sin rutas WMS. Admite búsqueda por nombre o archivo y filtro de estado. `tipos_disponibles` entrega los tipos aún no adjuntos considerando el expediente completo, antes de filtrar y paginar.
- `GET /api/documentos/:tipo/archivo`: vuelve a verificar el documento de ese cliente y transmite el archivo con `private, no-store`, MIME comprobado por firma y descarga adjunta. Permite SOLICITANTE y CONSULTA, con sesión normal y términos aceptados.
- `POST /api/documentos/:tipo`: carga un tipo documental faltante o actualiza el existente. Recibe directamente bytes PDF, JPG o PNG con su Content-Type y CSRF; no recibe cliente, ruta, nombre de archivo ni URL. Verifica firma, tamaño y permisos de nuevo antes de guardar. Solo SOLICITANTE. La auditoría distingue DOCUMENTO_CARGADO de DOCUMENTO_ACTUALIZADO; la carga inicial tiene referencia anterior nula.

`DOCUMENTOS_MAX_ARCHIVO_BYTES=10485760` está en `.env`. La excepción de carga binaria se limita al POST de documentos; el resto conserva JSON estricto y sus límites. Los bytes se mantienen transitoriamente en memoria. El backend consulta los metadatos WMS del cliente de la sesión y solo admite archivos en su carpeta exacta. Nunca acepta una ruta o URL del navegador y no sigue redirecciones. No reintenta automáticamente actualizaciones inciertas.

La integración envía el archivo al PUT existente de documentos WMS con credencial privada y `x-preservar-documento-anterior:true`. El ajuste autorizado en WMS conserva el archivo anterior para solicitudes autenticadas como servicio y asigna un nombre único a la nueva versión. La ficha WMS apunta al nuevo archivo. La auditoría en externalclientes registra intento y confirmación con actor, sesión, dispositivo, fecha UTC, IP, hash y referencias WMS; no registra el contenido del archivo. Las versiones anteriores no se exponen en el portal.

Pruebas sin iniciar servidores: `npm run test:documents` aquí; `node --test test/cliente-documentos-versiones.test.js` en WMS; `npm run test:documents` en FrontClientes después de compilar. Las escrituras se simulan o usan una base aislada; la verificación local de los seis archivos del cliente fue exclusivamente de lectura.

### Seguimiento de recepción y cambios de operaciones

Clients Fastway distingue un lote aún sin ingreso de uno cerrado con la misma regla de Genika: sin registros de inventario → Pendiente por revisión; con registros del lote y todos los saldos en cero → Lote cerrado (`recepcion.estado: CERRADA`). El cierre tiene prioridad sobre los estados de presencia y considera todo el inventario del lote, no solo los productos de la declaración. El ingreso como operación permanece confirmado; no se escriben estados ni saldos en WMS.

El estado de una precarga consulta el inventario actual de su lote y cliente a través de externalclientes: ninguno de sus productos con saldo positivo → Pendiente por revisión; algunos → Ingreso parcial; todos → Ingreso confirmado. Se compara presencia de productos, independientemente de que la cantidad actual sea menor que la declarada. Las referencias externas de una misma ficha WMS cuentan una sola vez y no duplican cantidades. El listado, el detalle y la agenda usan esta misma regla; una caída de WMS muestra Recepción por verificar. El detalle muestra cantidades actuales de inventario y sus unidades, sin guardar saldos adicionales ni exponer ubicaciones. La consulta permanece disponible para SOLICITANTE y CONSULTA.

`database/007-cambios-operacion.sql` añade solamente `operacion_cambios` en externalclientes. Ya fue aplicada en la base local con autorización del usuario: 34 tablas y 77 claves foráneas. No añade campos ni modifica la estructura o el código de WMS. No migra datos al iniciar. En otra instalación se aplica después de 001 a 006 con `npm run db:migrate:operation-changes`.

`OPERACION_CAMBIOS_HABILITADOS=true` activa el modelo y los endpoints de cambio. Requiere la migración 007. Para una instalación anterior pendiente de migración se puede dejar en false; no debe desactivarse después de registrar cambios, porque estos contienen la programación vigente. Recargar el proceso de externalclientes después de cambiar `.env`.

- `POST /api/operaciones/:public_id/cambios`: sesión del cliente, perfil SOLICITANTE, CSRF y términos vigentes. Cuerpo: `{request_id,tipo,motivo,datos}`. CANCELAR recibe datos vacíos; REPROGRAMAR recibe `fecha_programada_at` en Colombia y vuelve a validar horario y anticipación; CORREGIR recibe nombre, destinatario y observación. No permite cambiar productos, cantidades, empresa ni ubicaciones. Un cambio abierto por operación; reintentos con el mismo UUID y contenido no se duplican.
- `POST /api/interno/operaciones/:public_id/cambios/:change_id/decision`: JWT interno con esAdmin o gestionBodega. Recibe `{decision:"APLICAR"|"RECHAZAR",motivo}`; rechazar exige motivo. Guarda el actor y la fecha de decisión y conserva la solicitud original.

La fecha aprobada y las correcciones de contacto viven en externalclientes y aparecen en Clients Fastway y en Operaciones de clientes de Genika. La cabecera original WMS no se sobrescribe; el módulo interno indica su fecha original cuando difiere. Las programaciones guardan solicitante, aprobador, motivo y plazo aplicado utilizando los campos que ya existen en externalclientes.

Al aprobar una cancelación se utiliza el PATCH existente de WMS con el JWT del operador. Solo se marca aplicada al verificar CANCELADO en el mismo alistamiento y cliente. Una respuesta incierta queda CONCILIAR y se vuelve a consultar sin repetir la mutación; si sigue abierto, el operador puede cancelarlo en Gestión Bodega y verificar de nuevo desde este módulo. Una salida confirmada no se cancela desde el portal. El inventario y la confirmación de salida continúan bajo el proceso existente de WMS.

Las pruebas `test/operations.integration.test.js` crean y eliminan una base temporal con nombre aleatorio, sin escribir en externalclientes ni en la base de WMS. Todas las llamadas a WMS están simuladas. Las pruebas visuales interceptan las peticiones y no envían operaciones reales.

### Programación bodega integrada en Mi agenda de Genika

`GET /api/interno/programacion-bodega` permite consultar lo agendado a cualquier usuario autenticado con JWT WMS válido. No autoriza escrituras ni devuelve ubicaciones, sesiones o dispositivos. Admite `page`, `limit`, `buscar`, `desde` y `hasta`; las fechas son días de Colombia, inclusivos, con ambos límites obligatorios cuando se filtra por fecha y un máximo de 93 días. Se ordena y pagina en la base usando la última programación existente, incluida la reprogramación aprobada, antes de consultar los estados WMS. El front pide páginas de 25 y ofrece periodos de 1, 7 o 30 días. Las consultas operativas completas y las decisiones siguen exigiendo gestionBodega o esAdmin.

`GET /api/interno/lotes/:wms_lote_id/declaracion` permite a gestionBodega o esAdmin leer la declaración asociada exactamente al lote, incluidas referencias, transporte, contenedor, observaciones y cantidades. Devuelve null si no procede del portal; una relación ambigua produce error. Este permiso no habilita las rutas administrativas anteriores de creación ni aprobación.

Estas consultas utilizan tablas, columnas y endpoints WMS existentes. No requieren migraciones ni modificaciones de código o estructura en WMS. FrontWms integra la declaración en Lotes y la programación vigente en el alistamiento habitual, y retira las bandejas antiguas de validación.
