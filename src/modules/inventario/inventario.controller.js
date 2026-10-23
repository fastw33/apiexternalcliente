const handle = require('../../utils/asyncHandler')
function createInventarioController(service) {
  return {
    list: handle(async (req, res) =>
      res.json(await service.list(req.customer, req.query)),
    ),
    products: handle(async (req, res) =>
      res.json(await service.products(req.customer, req.query)),
    ),
    lots: handle(async (req, res) =>
      res.json(await service.lots(req.customer, req.params.codigo, req.query)),
    ),
  }
}
module.exports = { createInventarioController }
