-- Actualización aditiva: ejecutar después de 001-inicial.sql, una sola vez.
-- No publica documentos ni acepta condiciones en nombre de usuarios.
USE `externalclientes`;
SET time_zone = '+00:00';

CREATE TABLE `terminos_versiones` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `version` VARCHAR(80) COLLATE utf8mb4_bin NOT NULL,
  `titulo` VARCHAR(250) NOT NULL,
  `contenido` LONGTEXT NOT NULL,
  `contenido_sha256` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `publicado_por_actor_id` BIGINT UNSIGNED NOT NULL,
  `publicado_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_terminos_version` (`version`),
  CONSTRAINT `fk_terminos_actor` FOREIGN KEY (`publicado_por_actor_id`) REFERENCES `actores` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `terminos_aceptaciones` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `terminos_id` BIGINT UNSIGNED NOT NULL,
  `cliente_id` BIGINT UNSIGNED NOT NULL,
  `usuario_id` BIGINT UNSIGNED NOT NULL,
  `sesion_id` BIGINT UNSIGNED NOT NULL,
  `dispositivo_id` BIGINT UNSIGNED NOT NULL,
  `autoriza_tratamiento_datos` BOOLEAN NOT NULL,
  `ip_origen` VARCHAR(45) NOT NULL,
  `navegador` VARCHAR(500) NOT NULL,
  `correlation_id` CHAR(36) NOT NULL,
  `aceptado_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_aceptacion_usuario_version` (`usuario_id`, `terminos_id`),
  CONSTRAINT `ck_aceptacion_datos` CHECK (`autoriza_tratamiento_datos` = TRUE),
  CONSTRAINT `fk_aceptacion_terminos` FOREIGN KEY (`terminos_id`) REFERENCES `terminos_versiones` (`id`),
  CONSTRAINT `fk_aceptacion_usuario` FOREIGN KEY (`cliente_id`, `usuario_id`) REFERENCES `usuarios_externos` (`cliente_id`, `id`),
  CONSTRAINT `fk_aceptacion_sesion` FOREIGN KEY (`cliente_id`, `sesion_id`) REFERENCES `sesiones` (`cliente_id`, `id`),
  CONSTRAINT `fk_aceptacion_dispositivo` FOREIGN KEY (`cliente_id`, `usuario_id`, `dispositivo_id`) REFERENCES `dispositivos` (`cliente_id`, `usuario_id`, `id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
