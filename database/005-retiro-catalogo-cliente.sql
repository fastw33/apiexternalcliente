-- Solo retira la relación del catálogo de un cliente. No borra productos ni historial.
USE `externalclientes`;
ALTER TABLE `cliente_producto`
  ADD COLUMN IF NOT EXISTS `retirado_at` DATETIME(6) NULL DEFAULT NULL;
