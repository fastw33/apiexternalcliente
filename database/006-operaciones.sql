-- La revisión conserva la petición inmutable con productos/lotes WMS, incluso históricos sin ficha externa.
ALTER TABLE `externalclientes`.`alistamientos`
  ADD COLUMN `wms_alistamiento_id` INT NULL,
  ADD UNIQUE KEY `uq_alistamiento_wms` (`wms_alistamiento_id`);
