const { readCookie } = require('./security')

function createSessionCookies(config) {
  const options = {httpOnly:true,secure:config.cookie.secure,sameSite:config.cookie.sameSite,path:'/'}
  return {
    sessionToken:req=>readCookie(req,config.cookie.sessionName),
    deviceToken:req=>readCookie(req,config.cookie.deviceName),
    setSession:(res,session)=>res.cookie(config.cookie.sessionName,session.token,{...options,expires:session.expires}),
    setDevice:(res,token)=>res.cookie(config.cookie.deviceName,token,{...options,maxAge:config.session.deviceDays*86400000}),
    clearSession:res=>res.clearCookie(config.cookie.sessionName,options),
  }
}
module.exports = { createSessionCookies }
