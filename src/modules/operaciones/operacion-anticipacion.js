const { fail } = require("../../utils/errors");
function validateLead(pickup, registeredAt, minutes, processName = "la recogida") {
  if (
    !Number.isInteger(minutes) ||
    minutes < 1 ||
    minutes > 10080 ||
    !registeredAt ||
    !Number.isFinite(+new Date(registeredAt))
  )
    fail(
      409,
      "PROGRAMACION_SIN_VALIDAR",
      "No se pudo verificar la anticipación registrada de la operación.",
    );
  if (
    !Number.isFinite(+new Date(pickup)) ||
    +new Date(pickup) - +new Date(registeredAt) < minutes * 60000
  ) {
    const label =
      minutes % 60 === 0 ? `${minutes / 60} horas` : `${minutes} minutos`;
    fail(
      422,
      "ANTICIPACION_INSUFICIENTE",
      `Agenda ${processName} con al menos ${label} desde el registro de la solicitud.`,
    );
  }
}
module.exports = { validateLead };
