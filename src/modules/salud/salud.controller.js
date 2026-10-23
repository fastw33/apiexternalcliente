const handle = require('../../utils/asyncHandler')

function createSaludController(service) {
  return {
    health:(req,res)=>res.json(service.health()),
    ready:handle(async(req,res)=>{
      const status=await service.readiness()
      res.status(status.status==='ready' ? 200 : 503).json(status)
    }),
  }
}
module.exports = { createSaludController }
