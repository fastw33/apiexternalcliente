const handle = require('../../utils/asyncHandler')

function createUsuarioController(service) {
  return {
    list:handle(async(req,res)=>res.json(await service.list(req.validated.query))),
    provision:handle(async(req,res)=>res.status(201).json(await service.provision(req.body,req.internal,req.context))),
    changeState:handle(async(req,res)=>res.json(await service.changeState(req.params.id,req.body.estado,req.internal,req.context))),
    resetPassword:handle(async(req,res)=>res.json(await service.resetPassword(req.params.id,req.internal,req.context))),
  }
}
module.exports = { createUsuarioController }
