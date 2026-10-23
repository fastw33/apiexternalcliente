const fs=require('node:fs')
const path=require('node:path')
const {spawnSync}=require('node:child_process')

const version=fs.readFileSync(path.join(__dirname,'../.node-version'),'utf8').trim()
const executable=process.versions.node === version ? process.execPath :
  process.env.NVM_HOME ? path.join(process.env.NVM_HOME,`v${version}`,'node.exe') : null

if (!executable || !fs.existsSync(executable)) {
  console.error(`externalclientes requiere Node ${version}. Instálalo con nvm install ${version}.`)
  process.exit(1)
}
// Solo el proceso de este proyecto recibe el runtime; no cambia el selector global de nvm.
const result=spawnSync(executable,process.argv.slice(2),{stdio:'inherit',shell:false,
  env:{...process.env,PATH:`${path.dirname(executable)}${path.delimiter}${process.env.PATH || ''}`}})
if (result.error) console.error('No fue posible iniciar el runtime de externalclientes.')
process.exitCode=result.status ?? 1
