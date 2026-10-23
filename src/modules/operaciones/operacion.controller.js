const handle = require('../../utils/asyncHandler')
function createOperacionController(service, cambios, agenda) {
  return {
    change: handle(async (req, res) => {
      await cambios.request(
        req.customer,
        req.params.public_id,
        req.body,
        req.context,
      )
      res
        .status(201)
        .json(await service.detail(req.customer, req.params.public_id))
    }),
    list: handle(async (req, res) =>
      res.json(
        agenda
          ? await agenda.list(req.query, req.customer.cliente_id)
          : await service.list(req.customer, req.query),
      ),
    ),
    detail: handle(async (req, res) =>
      res.json(
        agenda
          ? await agenda.detail(req.params.public_id, req.customer.cliente_id)
          : await service.detail(req.customer, req.params.public_id),
      ),
    ),
    create: handle(async (req, res) =>
      res
        .status(201)
        .json(await service.create(req.customer, req.body, req.context)),
    ),
    integrate: handle(async (req, res) =>
      res.json(
        await service.integrate(
          req.customer,
          req.params.public_id,
          req.context,
        ),
      ),
    ),
  }
}
module.exports = { createOperacionController }
