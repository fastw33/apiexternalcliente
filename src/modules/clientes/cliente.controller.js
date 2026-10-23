const handle = require('../../utils/asyncHandler')

function createClienteController(service) {
  return {
    list:handle(async(req,res)=>res.json(await service.list(req.validated.query,req.internal))),
    validate:handle(async(req,res)=>res.json(await service.validate(req.params.id,req.internal))),
    changeState:handle(async(req,res)=>res.json(await service.changeState(req.params.id,req.body.habilitado,req.internal,req.context))),
  }
}
module.exports = { createClienteController }
