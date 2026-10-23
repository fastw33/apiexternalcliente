const handle = require('../../utils/asyncHandler')
function createProductoController(service) {
  return {
    catalog: (req, res) => res.json(service.catalog()),
    directory: handle(async (req, res) =>
      res.json(await service.directory(req.query)),
    ),
    suggestions: handle(async (req, res) =>
      res.json(await service.suggestions(req.query)),
    ),
    useExisting: handle(async (req, res) =>
      res.json(
        await service.useExisting(
          req.customer,
          req.body.codigo_wms,
          req.context,
        ),
      ),
    ),
    confirm: handle(async (req, res) =>
      res.json(await service.confirm(req.customer, req.params.id, req.context)),
    ),
    remove: handle(async (req, res) =>
      res.json(await service.remove(req.customer, req.params.id, req.context)),
    ),
    list: handle(async (req, res) =>
      res.json(await service.list(req.customer, req.query)),
    ),
    create: handle(async (req, res) =>
      res
        .status(201)
        .json(await service.create(req.customer, req.body, req.context)),
    ),
  }
}
module.exports = { createProductoController }
