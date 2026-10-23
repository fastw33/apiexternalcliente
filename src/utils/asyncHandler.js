module.exports = handler => (req,res,next)=>Promise.resolve(handler(req,res)).catch(next)
