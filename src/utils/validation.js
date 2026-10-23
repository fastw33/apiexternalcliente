const { fail } = require('./errors')
const { string,username,clientId,positiveId,passwordInput,passwordValue } = require('./security')

const invalid = () => fail(400,'DATOS_INVALIDOS','El tipo, formato o tamaño de un campo no es válido.')
const text = (name,max) => value => string(value,name,1,max).trim() || invalid()
const oneOf = values => value => values.includes(value) ? value : invalid()
const integer = max => value => {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,5}$/.test(value) || Number(value) > max) invalid()
  return Number(value)
}
const id = value => typeof value === 'string' ? positiveId(value) : invalid()
const email = value => {
  value=text('correo',254)(value)
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value)) invalid()
  return value
}
const content = value => {
  if (typeof value !== 'string' || !value.trim() || value.length > 12000 ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value) || Buffer.from(value,'utf8').toString('utf8') !== value) invalid()
  return value
}
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : invalid()
const boolean = value => typeof value === 'boolean' ? value : invalid()

module.exports = {text,username,clientId,id,email,content,hash,boolean,
  page:integer(100000),limit:integer(100),profile:oneOf(['CONSULTA','SOLICITANTE']),
  state:oneOf(['ACTIVO','SUSPENDIDO']),password:config=>value=>passwordInput(value,'password',config),
  newPassword:config=>value=>passwordValue(value,config)}
