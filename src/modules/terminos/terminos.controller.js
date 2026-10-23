const handle = require('../../utils/asyncHandler')

function createTerminosController(service) {
  return {
    publicDocument:handle(async(req,res)=>res.json(await service.publicDocument())),
    get:handle(async(req,res)=>res.json(await service.get(req.customer))),
    accept:handle(async(req,res)=>res.json(await service.accept(req.customer,req.body,req.context))),
    publish:handle(async(req,res)=>res.status(201).json(await service.publish(req.body,req.internal,req.context))),
  }
}
module.exports = { createTerminosController }
