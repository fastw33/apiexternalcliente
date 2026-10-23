const { randomUUID } = require('node:crypto')
const { isIP } = require('node:net')

module.exports = (req,res,next)=>{
  req.correlationId=randomUUID()
  res.setHeader('X-Correlation-ID',req.correlationId)
  res.setHeader('Cache-Control','no-store')
  const ip=isIP(req.ip || '') ? req.ip : req.socket.remoteAddress
  req.context={correlationId:req.correlationId,ip:String(ip || '').slice(0,45),
    userAgent:String(req.headers['user-agent'] || '').replace(/[\u0000-\u001F\u007F]/g,'').slice(0,500)}
  next()
}
