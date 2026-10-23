-- Solo externalclientes. Conserva fichas y relaciones existentes.
-- Permite que fichas externas con referencias diferentes reutilicen un código WMS.
-- Cada versión sigue teniendo una sola equivalencia. No crea productos en WMS.
USE `externalclientes`;
ALTER TABLE `producto_equivalencia_wms`
  DROP INDEX IF EXISTS `uq_producto_equivalencia_wms_2`,
  ADD INDEX IF NOT EXISTS `ix_producto_equivalencia_wms_codigo` (`wms_producto_id`);
