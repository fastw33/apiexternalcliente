const { validateRequest } = require('./validateRequest.middleware')

module.exports = schema => validateRequest({body:schema})
