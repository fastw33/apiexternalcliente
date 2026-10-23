const handle = require('../../utils/asyncHandler')

function createAuthController({auth,sesiones,cookies}) {
  return {
    internalMe:(req,res)=>res.json({usuario:{id_usuario:req.internal.id,username:req.internal.username,
      id_personal:req.internal.personalId,esAdmin:true}}),
    login:handle(async(req,res)=>{
      const result=await auth.login(req.body,cookies.deviceToken(req),req.context)
      cookies.setSession(res,result.session)
      cookies.setDevice(res,result.deviceToken)
      res.json(result.view)
    }),
    me:handle(async(req,res)=>res.json(await auth.view(req.customer))),
    changePassword:handle(async(req,res)=>{
      const result=await auth.changePassword(req.customer,req.body,req.context)
      cookies.setSession(res,result.session)
      res.json(result.view)
    }),
    logout:handle(async(req,res)=>{
      await sesiones.logout(cookies.sessionToken(req),req.context)
      cookies.clearSession(res)
      res.status(204).end()
    }),
  }
}
module.exports = { createAuthController }
