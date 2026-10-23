const handle = require("../../utils/asyncHandler");
function createOperacionInternoController(service, cambios) {
  return {
    decide: handle(async (req,res) => {
      await cambios.decide(req.params.public_id,req.params.change_id,req.body,req.internal,req.context)
      res.json(await service.detail(req.params.public_id))
    }),
    list: handle(async (req, res) => res.json(await service.list(req.query))),
    detail: handle(async (req, res) =>
      res.json(await service.detail(req.params.public_id)),
    ),
  };
}
module.exports = { createOperacionInternoController };
