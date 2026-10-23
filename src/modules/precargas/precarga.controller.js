const handle = require('../../utils/asyncHandler')
function createPrecargaController(service) {
  return {
    list: handle(async (req, res) =>
      res.json(await service.list(req.customer, req.query)),
    ),
    detail: handle(async (req, res) =>
      res.json(await service.detail(req.customer, req.params.public_id)),
    ),
    create: handle(async (req, res) =>
      res
        .status(201)
        .json(await service.create(req.customer, req.body, req.context)),
    ),
    createLot: handle(async (req, res) =>
      res.json(
        await service.createLot(
          req.customer,
          req.params.public_id,
          req.body,
          req.context,
        ),
      ),
    ),
  }
}
module.exports = { createPrecargaController }
