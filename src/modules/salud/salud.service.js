function createSaludService({db}) {
  const health=()=>({status:'up',service:'externalclientes'})
  async function readiness() {
    try {
      await db.authenticate()
      return {status:'ready',dependencies:{database:'up'}}
    } catch {
      return {status:'not_ready',dependencies:{database:'down'}}
    }
  }
  return {health,readiness}
}
module.exports = { createSaludService }
