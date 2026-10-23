const handle = require('../../utils/asyncHandler')

function createSesionController({sesiones,cookies}) {
  return {
    list:handle(async(req,res)=>res.json(await sesiones.list(req.customer))),
    revoke:handle(async(req,res)=>{
      if (await sesiones.revoke(req.customer,req.params.id,req.context)) cookies.clearSession(res)
      res.status(204).end()
    }),
  }
}
module.exports = { createSesionController }
