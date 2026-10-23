-- Presentación declarada del producto; no asigna códigos de WMS.
-- Cambio aditivo. No modifica fichas ni códigos existentes.
USE `externalclientes`;
ALTER TABLE `producto_versiones`
  ADD COLUMN IF NOT EXISTS `prefijo` VARCHAR(80) NULL AFTER `tipo`;
