const { requestFields } = require('../utils/logger')

module.exports = logger => (req,res,next)=>{
  const started=process.hrtime.bigint()
  let recorded=false
  function record(aborted) {
    if (recorded) return
    recorded=true
    const status=aborted ? 499 : res.statusCode
    const level=status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info'
    logger[level](aborted ? 'HTTP_ABORTADA' : 'HTTP_COMPLETADA',{...requestFields(req),
      http_status:status,duracion_ms:Math.round(Number(process.hrtime.bigint()-started)/1e6),codigo:res.locals.errorCode})
  }
  res.once('finish',()=>record(false))
  res.once('close',()=>record(!res.writableFinished))
  next()
}
