const handle = require('../../utils/asyncHandler')
function createMovimientoController(service) {
  return {
    list: handle(async (req, res) =>
      res.json(await service.list(req.customer, req.query)),
    ),
  }
}
module.exports = { createMovimientoController }
