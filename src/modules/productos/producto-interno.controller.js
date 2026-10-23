const handle = require('../../utils/asyncHandler')
function createProductoInternoController(service) {
  return {
    list: handle(async (req, res) =>
      res.json(await service.list(req.validated.query))
    ),
    search: handle(async (req, res) =>
      res.json(await service.search(req.validated.query, req.internal))
    ),
    approve: handle(async (req, res) =>
      res.json(
        await service.approve(
          req.params.id,
          req.body,
          req.internal,
          req.context
        )
      )
    ),
  }
}
module.exports = { createProductoInternoController }
