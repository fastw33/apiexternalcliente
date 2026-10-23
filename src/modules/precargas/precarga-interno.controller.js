const handle = require('../../utils/asyncHandler')
function createPrecargaInternoController(service, lotes) {
  return {
    byLot: handle(async (req, res) =>
      res.json(await service.byLot(req.params.wms_lote_id)),
    ),
    list: handle(async (req, res) => res.json(await service.list(req.query))),
    detail: handle(async (req, res) =>
      res.json(await service.detail(req.params.public_id)),
    ),
    createLot: handle(async (req, res) =>
      res.json(
        await lotes.createForInternal(
          req.params.public_id,
          req.body,
          req.internal,
          req.context,
        ),
      ),
    ),
  }
}
module.exports = { createPrecargaInternoController }
