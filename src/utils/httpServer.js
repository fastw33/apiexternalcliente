const http = require('node:http')
const {randomUUID} = require('node:crypto')

function createHttpServer(app,config,logger) {
  const server=http.createServer({headersTimeout:config.http.headersTimeoutMs,
    requestTimeout:config.http.requestTimeoutMs,maxHeaderSize:config.http.maxHeaderBytes},app)
  server.keepAliveTimeout=config.http.keepAliveTimeoutMs
  server.maxRequestsPerSocket=config.http.maxRequestsPerSocket
  server.maxHeadersCount=50
  server.setTimeout(config.http.socketTimeoutMs,socket=>socket.destroy())
  server.on('clientError',(error,socket)=>{
    const correlationId=randomUUID()
    const oversized=error.code === 'HPE_HEADER_OVERFLOW'
    const code=oversized ? 'CABECERAS_EXCESIVAS' : 'PROTOCOLO_INVALIDO'
    logger.warn('HTTP_PROTOCOLO_RECHAZADO',{correlation_id:correlationId,codigo:code,ip:socket.remoteAddress})
    if (error.code === 'ECONNRESET' || !socket.writable) {socket.destroy();return}
    const status=oversized ? 431 : 400
    const body=JSON.stringify({error:{code,message:'La petición HTTP no es válida.'},correlation_id:correlationId})
    socket.end(`HTTP/1.1 ${status} ${oversized ? 'Request Header Fields Too Large' : 'Bad Request'}\r\nConnection: close\r\nContent-Type: application/json\r\nX-Correlation-ID: ${correlationId}\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
  })
  return server
}
module.exports = { createHttpServer }
