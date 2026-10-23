const handle = require('../../utils/asyncHandler')
function createDocumentoController(service) {
  return {
    list: handle(async (req, res) => {
      res.set('Cache-Control', 'private, no-store')
      res.json(await service.list(req.customer, req.query))
    }),
    file: handle(async (req, res) => {
      const result = await service.file(
        req.customer,
        req.params.tipo,
        req.context,
      )
      res.set({
        'Content-Type': result.mime,
        'Content-Disposition': 'attachment; filename="' + result.filename + '"',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      })
      res.send(result.buffer)
    }),
    update: handle(async (req, res) =>
      res.json(
        await service.update(
          req.customer,
          req.params.tipo,
          req.body,
          req.headers['content-type']?.split(';')[0].trim().toLowerCase(),
          req.context,
        ),
      ),
    ),
  }
}
module.exports = { createDocumentoController }
