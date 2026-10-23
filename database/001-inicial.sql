-- externalclientes / instalación inicial local / v1 / 2026-10-19
-- Destino: MariaDB 10.6 o posterior, InnoDB. Versión local no confirmada.
-- SQL generado y revisado; NO ejecutado por el asistente en tu servidor.
-- Importar UNA VEZ en una base externalclientes nueva o vacía.
-- Puede importarse desde la vista general del servidor en phpMyAdmin/HeidiSQL.
-- Crea la base si no existe; si existe, conserva sus opciones y no reemplaza tablas.
-- Si ya contiene tablas de esta instalación, detener y revisar: no es una actualización.
-- No borra tablas, no carga datos de prueba y no crea usuarios ni contraseñas.
-- No accede a las bases WMS o Tareas y Proyectos; referencias remotas se guardan como IDs.
-- No usar la opción del importador que continúa/ignora errores.
-- El DDL no se revierte completo con ROLLBACK; ante error no repetir a ciegas.
-- Configurar también las futuras conexiones de externalclientes con zona UTC.
-- JSON se conserva como tipo MariaDB (alias LONGTEXT validado).
-- Columna calculada de agenda usa STORED (alias de PERSISTENT); fechas DATETIME(6).
-- Cantidades DECIMAL, evitando una copia local del saldo físico de inventario.
-- Referencias oficiales consultadas:
-- https://mariadb.com/docs/server/reference/sql-statements/data-definition/create/generated-columns.md
-- https://mariadb.com/docs/server/reference/data-types/string-data-types/json.md

SET time_zone = '+00:00';
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SET SESSION foreign_key_checks = 1;
SET SESSION check_constraint_checks = 1;

CREATE DATABASE IF NOT EXISTS `externalclientes`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `externalclientes`;

-- Fase 1 / Identidad: Referencia de una empresa WMS habilitada para el portal; no reemplaza al cliente legal.
CREATE TABLE `externalclientes`.`clientes_vinculados` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `wms_cliente_id` VARCHAR(250) COLLATE utf8mb4_bin NOT NULL,
  `nombre_presentacion` VARCHAR(250) NOT NULL,
  `habilitado` BOOLEAN NOT NULL DEFAULT FALSE,
  `wms_activo_ultima_validacion` BOOLEAN NULL,
  `validado_wms_at` DATETIME(6) NULL,
  `creado_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `actualizado_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_clientes_vinculados_1` (`wms_cliente_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- Fase 1 / Identidad: Identidad de auditoría: cliente, empleado WMS o servicio. No guarda permisos internos ni JWT.
CREATE TABLE `externalclientes`.`actores` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tipo` ENUM('CLIENTE','INTERNO','SERVICIO') NOT NULL,
  `cliente_id` BIGINT UNSIGNED NULL,
  `wms_usuario_id` INT NULL,
  `wms_personal_id` VARCHAR(250) COLLATE utf8mb4_bin NULL,
  `codigo_servicio` VARCHAR(80) NULL,
  `nombre_presentacion` VARCHAR(250) NOT NULL,
  `creado_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_actores_1` (`cliente_id`, `id`),
  UNIQUE KEY `uq_actores_2` (`wms_usuario_id`),
  UNIQUE KEY `uq_actores_3` (`codigo_servicio`),
  CONSTRAINT `ck_actores_1` CHECK ((tipo = 'CLIENTE' AND cliente_id IS NOT NULL AND wms_usuario_id IS NULL AND wms_personal_id IS NULL AND codigo_servicio IS NULL) OR (tipo = 'INTERNO' AND cliente_id IS NULL AND wms_usuario_id IS NOT NULL AND wms_personal_id IS NOT NULL AND codigo_servicio IS NULL) OR (tipo = 'SERVICIO' AND cliente_id IS NULL AND wms_usuario_id IS NULL AND wms_personal_id IS NULL AND codigo_servicio IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- Fase 1 / Identidad: Solo Innovación aprovisiona. Los perfiles de cliente nunca otorgan aprobaciones internas.
CREATE TABLE `externalclientes`.`usuarios_externos` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `cliente_id` BIGINT UNSIGNED NOT NULL,
  `actor_id` BIGINT UNSIGNED NOT NULL,
  `username_normalizado` VARCHAR(100) NOT NULL,
  `correo` VARCHAR(254) NOT NULL,
  `password_hash` VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `debe_cambiar_password` BOOLEAN NOT NULL DEFAULT TRUE,
  `password_temporal_expira_at` DATETIME(6) NULL,
  `password_cambiado_at` DATETIME(6) NULL,
  `version_credenciales` INT UNSIGNED NOT NULL DEFAULT 1,
  `perfil` ENUM('CONSULTA','SOLICITANTE') NOT NULL DEFAULT 'SOLICITANTE',
  `estado` ENUM('ACTIVO','SUSPENDIDO','DESACTIVADO') NOT NULL DEFAULT 'ACTIVO',
  `bloqueado_hasta_at` DATETIME(6) NULL,
  `creado_por_actor_id` BIGINT UNSIGNED NOT NULL,
  `creado_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `actualizado_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_usuarios_externos_1` (`cliente_id`, `id`),
  UNIQUE KEY `uq_usuarios_externos_2` (`actor_id`),
  UNIQUE KEY `uq_usuarios_externos_3` (`username_normalizado`),
  KEY `ix_usuarios_externos_1` (`cliente_id`, `estado`),
  CONSTRAINT `ck_usuarios_externos_1` CHECK (version_credenciales > 0),
  CONSTRAINT `ck_usuarios_externos_2` CHECK (debe_cambiar_password = FALSE OR password_temporal_expira_at IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- Fase 1 / Identidad: Navegador registrado por usuario. Su identificador no demuestra hardware ni autentica por sí solo.
CREATE TABLE `externalclientes`.`dispositivos` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `cliente_id` BIGINT UNSIGNED NOT NULL,
  `usuario_id` BIGINT UNSIGNED NOT NULL,
  `identificador_hash` BINARY(32) NOT NULL,
  `nombre` VARCHAR(120) NULL,
  `navegador` VARCHAR(500) NULL,
  `ultimo_uso_at` DATETIME(6) NULL,
  `revocado_at` DATETIME(6) NULL,
  `creado_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_dispositivos_1` (`cliente_id`, `usuario_id`, `id`),
  UNIQUE KEY `uq_dispositivos_2` (`usuario_id`, `identificador_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- Fase 1 / Identidad: Sesión opaca revocable; cookie secreta solo en navegador y hash en servidor. No guarda JWT completos.
CREATE TABLE `externalclientes`.`sesiones` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `cliente_id` BIGINT UNSIGNED NOT NULL,
  `usuario_id` BIGINT UNSIGNED NOT NULL,
  `dispositivo_id` BIGINT UNSIGNED NOT NULL,
  `secreto_hash` BINARY(32) NOT NULL,
  `tipo` ENUM('PROVISIONAL','NORMAL') NOT NULL,
  `version_credenciales` INT UNSIGNED NOT NULL,
  `ip_inicio` VARCHAR(45) CHARACTER SET ascii NOT NULL,
  `navegador_inicio` VARCHAR(500) NOT NULL,
  `creado_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `ultimo_uso_at` DATETIME(6) NOT NULL,
  `expira_at` DATETIME(6) NOT NULL,
  `revocada_at` DATETIME(6) NULL,
  `motivo_revocacion` VARCHAR(120) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_sesiones_1` (`secreto_hash`),
  UNIQUE KEY `uq_sesiones_2` (`cliente_id`, `id`),
  KEY `ix_sesiones_1` (`usuario_id`, `revocada_at`, `expira_at`),
  KEY `ix_sesiones_2` (`expira_at`),
  CONSTRAINT `ck_sesiones_1` CHECK (expira_at > creado_at),
  CONSTRAINT `ck_sesiones_2` CHECK (version_credenciales > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- Fase 2 / Catálogo: Identidad canónica compartida; las características operativas se versionan.
CREATE TABLE `externalclientes`.`productos` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `codigo_maestro` VARCHAR(80) NOT NULL,
  `estado` ENUM('PROPUESTO','VALIDADO','INACTIVO') NOT NULL DEFAULT 'PROPUESTO',
  `creado_por_actor_id` BIGINT UNSIGNED NOT NULL,
  `creado_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `actualizado_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_productos_1` (`codigo_maestro`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- Fase 2 / Catálogo: Ficha congelada al usarla en una revisión enviada. Cambios operativos requieren otra versión y homologación.
CREATE TABLE `externalclientes`.`producto_versiones` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `producto_id` BIGINT UNSIGNED NOT NULL,
  `numero_version` INT UNSIGNED NOT NULL,
  `nombre` VARCHAR(250) NOT NULL,
  `referencia` VARCHAR(250) NOT NULL,
  `tipo` VARCHAR(250) NOT NULL,
  `unidad_medida` VARCHAR(15) NOT NULL,
  `alto_cm` DECIMAL(14,4) NOT NULL,
  `ancho_cm` DECIMAL(14,4) NOT NULL,
  `largo_cm` DECIMAL(14,4) NOT NULL,
  `estado` ENUM('PROPUESTA','HOMOLOGADA','RETIRADA') NOT NULL DEFAULT 'PROPUESTA',
  `creado_por_actor_id` BIGINT UNSIGNED NOT NULL,
  `homologado_por_actor_id` BIGINT UNSIGNED NULL,
  `homologado_at` DATETIME(6) NULL,
  `creado_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_producto_versiones_1` (`producto_id`, `numero_version`),
  UNIQUE KEY `uq_producto_versiones_2` (`producto_id`, `id`),
  CONSTRAINT `ck_producto_versiones_1` CHECK (numero_version > 0),
  CONSTRAINT `ck_producto_versiones_2` CHECK (alto_cm >= 0 AND ancho_cm >= 0 AND largo_cm >= 0),
  CONSTRAINT `ck_producto_versiones_3` CHECK (estado <> 'HOMOLOGADA' OR (homologado_por_actor_id IS NOT NULL AND homologado_at IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- Fase 2 / Catálogo: Permite compartir ficha sin compartir códigos propios ni mercancía. Deshabilitar impide nuevas precargas; conserva consulta y despacho de stock propio.
CREATE TABLE `externalclientes`.`cliente_producto` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `cliente_id` BIGINT UNSIGNED NOT NULL,
  `producto_id` BIGINT UNSIGNED NOT NULL,
  `codigo_cliente` VARCHAR(120) NOT NULL,
  `alias_cliente` VARCHAR(250) NULL,
  `estado` ENUM('PENDIENTE','HABILITADO','DESHABILITADO') NOT NULL DEFAULT 'PENDIENTE',
  `creado_por_actor_id` BIGINT UNSIGNED NOT NULL,
  `creado_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `actualizado_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cliente_producto_1` (`cliente_id`, `producto_id`),
  UNIQUE KEY `uq_cliente_producto_2` (`cliente_id`, `codigo_cliente`),
  UNIQUE KEY `uq_cliente_producto_3` (`cliente_id`, `id`, `producto_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- Fase 2 / Catálogo: Una versión homologada corresponde a un producto operativo WMS. Propuesta inicial 1:1; varios clientes comparten la misma versión.
CREATE TABLE `externalclientes`.`producto_equivalencia_wms` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `producto_version_id` BIGINT UNSIGNED NOT NULL,
  `wms_producto_id` VARCHAR(250) COLLATE utf8mb4_bin NOT NULL,
  `validado_por_actor_id` BIGINT UNSIGNED NOT NULL,
  `validado_at` DATETIME(6) NOT NULL,
  `creado_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_producto_equivalencia_wms_1` (`producto_version_id`),
  UNIQUE KEY `uq_producto_equivalencia_wms_2` (`wms_producto_id`),
  UNIQUE KEY `uq_producto_equivalencia_wms_3` (`producto_version_id`, `wms_producto_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- Fase 4 / Catálogo: Solo referencias y pertenencia validada de lote-producto; NO guarda cantidades disponibles ni ubicaciones. Puede vincular mercancía previa al portal.
CREATE TABLE `externalclientes`.`referencias_stock_wms` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `cliente_id` BIGINT UNSIGNED NOT NULL,
  `cliente_producto_id` BIGINT UNSIGNED NOT NULL,
  `producto_id` BIGINT UNSIGNED NOT NULL,
  `producto_version_id` BIGINT UNSIGNED NOT NULL,
  `wms_producto_id` VARCHAR(250) COLLATE utf8mb4_bin NOT NULL,
  `wms_lote_id` VARCHAR(250) COLLATE utf8mb4_bin NOT NULL,
  `wms_lote_producto_id` VARCHAR(250) COLLATE utf8mb4_bin NOT NULL,
  `validado_at` DATETIME(6) NOT NULL,
  `creado_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_referencias_stock_wms_1` (`wms_lote_producto_id`),
  UNIQUE KEY `uq_referencias_stock_wms_2` (`cliente_id`, `id`, `producto_version_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- Fase 3 / Solicitudes: Cabecera de negocio común: precarga, alistamiento o servicio. Su estado NO es el estado de envío ni la ejecución física.
CREATE TABLE `externalclientes`.`solicitudes` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `public_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `cliente_id` BIGINT UNSIGNED NOT NULL,
  `tipo` ENUM('PRECARGA','ALISTAMIENTO','SERVICIO') NOT NULL,
  `estado` ENUM('BORRADOR','ENVIADA','OBSERVADA','APROBADA','RECHAZADA','CANCELACION_SOLICITADA','CANCELADA','CERRADA') NOT NULL DEFAULT 'BORRADOR',
  `revision_actual` INT UNSIGNED NOT NULL DEFAULT 1,
  `revision_aprobada` INT UNSIGNED NULL,
  `version_lock` INT UNSIGNED NOT NULL DEFAULT 1,
  `observacion_cliente` TEXT NULL,
  `creado_por_actor_id` BIGINT UNSIGNED NOT NULL,
  `creado_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `actualizado_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_solicitudes_1` (`public_id`),
  UNIQUE KEY `uq_solicitudes_2` (`cliente_id`, `id`),
  UNIQUE KEY `uq_solicitudes_3` (`cliente_id`, `id`, `tipo`),
  KEY `ix_solicitudes_1` (`cliente_id`, `tipo`, `estado`, `creado_at`),
  CONSTRAINT `ck_solicitudes_1` CHECK (revision_actual > 0 AND version_lock > 0),
  CONSTRAINT `ck_solicitudes_2` CHECK (revision_aprobada IS NULL OR revision_aprobada <= revision_actual)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- Fase 3 / Solicitudes: Instantánea inmutable del contenido enviado: productos versionados, cantidades y documentos. Una revisión aprobada nunca se sobrescribe.
CREATE TABLE `externalclientes`.`solicitud_revisiones` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `cliente_id` BIGINT UNSIGNED NOT NULL,
  `solicitud_id` BIGINT UNSIGNED NOT NULL,
  `numero_revision` INT UNSIGNED NOT NULL,
  `contenido` JSON NOT NULL,
  `contenido_sha256` BINARY(32) NOT NULL,
  `enviado_por_actor_id` BIGINT UNSIGNED NOT NULL,
  `enviado_at` DATETIME(6) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_solicitud_revisiones_1` (`cliente_id`, `solicitud_id`, `numero_revision`),
  CONSTRAINT `ck_solicitud_revisiones_1` CHECK (numero_revision > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- Fase 3 / Solicitudes: Una decisión interna por revisión enviada; una corrección genera otra revisión. WMS sigue siendo la fuente de permisos internos.
CREATE TABLE `externalclientes`.`decisiones_solicitud` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `cliente_id` BIGINT UNSIGNED NOT NULL,
  `solicitud_id` BIGINT UNSIGNED NOT NULL,
  `numero_revision` INT UNSIGNED NOT NULL,
  `decision` ENUM('APROBADA','OBSERVADA','RECHAZADA') NOT NULL,
  `motivo` VARCHAR(1000) NULL,
  `decidido_por_actor_id` BIGINT UNSIGNED NOT NULL,
  `decidido_at` DATETIME(6) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_decisiones_solicitud_1` (`cliente_id`, `solicitud_id`, `numero_revision`),
  CONSTRAINT `ck_decisiones_solicitud_1` CHECK (decision = 'APROBADA' OR (motivo IS NOT NULL AND CHAR_LENGTH(TRIM(motivo)) > 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- Fase 3 / Agenda: Historial de fechas solicitadas y confirmadas. Una sola programación vigente; no representa reserva de cupo ni de stock.
CREATE TABLE `externalclientes`.`programaciones` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `cliente_id` BIGINT UNSIGNED NOT NULL,
  `solicitud_id` BIGINT UNSIGNED NOT NULL,
  `fecha_solicitada_at` DATETIME(6) NOT NULL,
  `fecha_confirmada_at` DATETIME(6) NULL,
  `estado` ENUM('SOLICITADA','CONFIRMADA','REEMPLAZADA','CANCELADA') NOT NULL DEFAULT 'SOLICITADA',
  `solicitud_vigente` BIGINT UNSIGNED GENERATED ALWAYS AS (CASE WHEN estado IN ('SOLICITADA','CONFIRMADA') THEN solicitud_id ELSE NULL END) STORED,
  `anticipo_minutos_aplicado` INT UNSIGNED NULL,
  `plazo_validado_at` DATETIME(6) NULL,
  `motivo_cambio` VARCHAR(1000) NULL,
  `creado_por_actor_id` BIGINT UNSIGNED NOT NULL,
  `confirmado_por_actor_id` BIGINT UNSIGNED NULL,
  `creado_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_programaciones_1` (`cliente_id`, `solicitud_vigente`),
  KEY `ix_programaciones_1` (`fecha_confirmada_at`, `estado`),
  CONSTRAINT `ck_programaciones_1` CHECK (anticipo_minutos_aplicado IS NULL OR anticipo_minutos_aplicado > 0),
  CONSTRAINT `ck_programaciones_2` CHECK ((anticipo_minutos_aplicado IS NULL AND plazo_validado_at IS NULL) OR (anticipo_minutos_aplicado IS NOT NULL AND plazo_validado_at IS NOT NULL)),
  CONSTRAINT `ck_programaciones_3` CHECK (estado <> 'CONFIRMADA' OR (fecha_confirmada_at IS NOT NULL AND confirmado_por_actor_id IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- Fase 3 / Precargas: Datos específicos de recepción prevista; no crea inventario.
CREATE TABLE `externalclientes`.`precargas` (
  `solicitud_id` BIGINT UNSIGNED NOT NULL,
  `cliente_id` BIGINT UNSIGNED NOT NULL,
  `tipo_solicitud` ENUM('PRECARGA','ALISTAMIENTO','SERVICIO') NOT NULL DEFAULT 'PRECARGA',
  `referencia_contenedor` VARCHAR(120) NULL,
  `referencia_transporte` VARCHAR(120) NULL,
  PRIMARY KEY (`solicitud_id`),
  UNIQUE KEY `uq_precargas_1` (`cliente_id`, `solicitud_id`),
  CONSTRAINT `ck_precargas_1` CHECK (tipo_solicitud = 'PRECARGA')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- Fase 3 / Agenda: Petición de operación o servicio sin alterar stock. Su recorrido a Tareas y Proyectos sigue pendiente.
CREATE TABLE `externalclientes`.`solicitudes_servicio` (
  `solicitud_id` BIGINT UNSIGNED NOT NULL,
  `cliente_id` BIGINT UNSIGNED NOT NULL,
  `tipo_solicitud` ENUM('PRECARGA','ALISTAMIENTO','SERVICIO') NOT NULL DEFAULT 'SERVICIO',
  `codigo_servicio` VARCHAR(80) NOT NULL,
  `descripcion` TEXT NOT NULL,
  PRIMARY KEY (`solicitud_id`),
  UNIQUE KEY `uq_solicitudes_servicio_1` (`cliente_id`, `solicitud_id`),
  CONSTRAINT `ck_solicitudes_servicio_1` CHECK (tipo_solicitud = 'SERVICIO')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- Fase 3 / Precargas: Lotes preliminares; cada lote se importa y concilia por separado.
CREATE TABLE `externalclientes`.`precarga_lotes` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `cliente_id` BIGINT UNSIGNED NOT NULL,
  `solicitud_id` BIGINT UNSIGNED NOT NULL,
  `referencia_cliente` VARCHAR(120) NOT NULL,
  `wms_lote_id` VARCHAR(250) COLLATE utf8mb4_bin NULL,
  `creado_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_precarga_lotes_1` (`cliente_id`, `solicitud_id`, `id`),
  UNIQUE KEY `uq_precarga_lotes_2` (`solicitud_id`, `referencia_cliente`),
  UNIQUE KEY `uq_precarga_lotes_3` (`wms_lote_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- Fase 3 / Precargas: Productos y cantidades declaradas; no son cantidades disponibles.
CREATE TABLE `externalclientes`.`precarga_detalles` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `cliente_id` BIGINT UNSIGNED NOT NULL,
  `solicitud_id` BIGINT UNSIGNED NOT NULL,
  `precarga_lote_id` BIGINT UNSIGNED NOT NULL,
  `cliente_producto_id` BIGINT UNSIGNED NOT NULL,
  `producto_id` BIGINT UNSIGNED NOT NULL,
  `producto_version_id` BIGINT UNSIGNED NOT NULL,
  `cantidad_declarada` DECIMAL(20,6) NOT NULL,
  `peso_unitario_kg` DECIMAL(18,6) NULL,
  `observacion` VARCHAR(1000) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_precarga_detalles_1` (`cliente_id`, `solicitud_id`, `id`, `producto_version_id`),
  CONSTRAINT `ck_precarga_detalles_1` CHECK (cantidad_declarada > 0),
  CONSTRAINT `ck_precarga_detalles_2` CHECK (peso_unitario_kg IS NULL OR peso_unitario_kg >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- Fase 4 / Recepciones: Proyección de entradas físicas confirmadas por WMS; cada entrada puede ser parcial. No es un segundo libro de inventario.
CREATE TABLE `externalclientes`.`recepciones_wms` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `cliente_id` BIGINT UNSIGNED NOT NULL,
  `solicitud_id` BIGINT UNSIGNED NOT NULL,
  `wms_entrada_id` VARCHAR(250) COLLATE utf8mb4_bin NOT NULL,
  `recibido_at` DATETIME(6) NOT NULL,
  `consultado_at` DATETIME(6) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_recepciones_wms_1` (`wms_entrada_id`),
  UNIQUE KEY `uq_recepciones_wms_2` (`cliente_id`, `solicitud_id`, `id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- Fase 4 / Recepciones: Resultado por línea WMS. Actualizar por ID remoto, no sumar cada consulta; las diferencias se revisan como incidencias.
CREATE TABLE `externalclientes`.`recepcion_detalles_wms` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `cliente_id` BIGINT UNSIGNED NOT NULL,
  `solicitud_id` BIGINT UNSIGNED NOT NULL,
  `recepcion_id` BIGINT UNSIGNED NOT NULL,
  `wms_detalle_id` VARCHAR(250) COLLATE utf8mb4_bin NOT NULL,
  `precarga_detalle_id` BIGINT UNSIGNED NULL,
  `producto_version_id` BIGINT UNSIGNED NOT NULL,
  `referencia_stock_id` BIGINT UNSIGNED NULL,
  `cantidad_recibida` DECIMAL(20,6) NOT NULL,
  `consultado_at` DATETIME(6) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_recepcion_detalles_wms_1` (`wms_detalle_id`),
  CONSTRAINT `ck_recepcion_detalles_wms_1` CHECK (cantidad_recibida >= 0),
  CONSTRAINT `ck_recepcion_detalles_wms_2` CHECK (cantidad_recibida = 0 OR referencia_stock_id IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- Fase 4 / Solicitudes: Faltantes, sobrantes, daño, producto distinto u otros. Resolver aquí no ajusta inventario WMS.
CREATE TABLE `externalclientes`.`incidencias_solicitud` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `cliente_id` BIGINT UNSIGNED NOT NULL,
  `solicitud_id` BIGINT UNSIGNED NOT NULL,
  `tipo` ENUM('FALTANTE','SOBRANTE','DANO','PRODUCTO_DISTINTO','OTRO') NOT NULL,
  `estado` ENUM('ABIERTA','EN_REVISION','RESUELTA') NOT NULL DEFAULT 'ABIERTA',
  `descripcion` TEXT NOT NULL,
  `resolucion` TEXT NULL,
  `creado_por_actor_id` BIGINT UNSIGNED NOT NULL,
  `resuelto_por_actor_id` BIGINT UNSIGNED NULL,
  `creado_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `resuelto_at` DATETIME(6) NULL,
  PRIMARY KEY (`id`),
  KEY `ix_incidencias_solicitud_1` (`cliente_id`, `solicitud_id`, `estado`),
  CONSTRAINT `ck_incidencias_solicitud_1` CHECK (estado <> 'RESUELTA' OR (resuelto_por_actor_id IS NOT NULL AND resuelto_at IS NOT NULL AND resolucion IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- Fase 5 / Alistamientos: Datos específicos de despacho solicitado. Programación y aprobación viven en la cabecera común.
CREATE TABLE `externalclientes`.`alistamientos` (
  `solicitud_id` BIGINT UNSIGNED NOT NULL,
  `cliente_id` BIGINT UNSIGNED NOT NULL,
  `tipo_solicitud` ENUM('PRECARGA','ALISTAMIENTO','SERVICIO') NOT NULL DEFAULT 'ALISTAMIENTO',
  `modalidad` ENUM('RECOGIDA','ENTREGA') NOT NULL,
  `destinatario` VARCHAR(250) NULL,
  `direccion_entrega` VARCHAR(500) NULL,
  PRIMARY KEY (`solicitud_id`),
  UNIQUE KEY `uq_alistamientos_1` (`cliente_id`, `solicitud_id`),
  CONSTRAINT `ck_alistamientos_1` CHECK (tipo_solicitud = 'ALISTAMIENTO')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- Fase 5 / Alistamientos: Cantidades pedidas y aprobadas por producto/lote propio. Pendientes se derivan; nunca son saldo de inventario.
CREATE TABLE `externalclientes`.`alistamiento_detalles` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `cliente_id` BIGINT UNSIGNED NOT NULL,
  `solicitud_id` BIGINT UNSIGNED NOT NULL,
  `referencia_stock_id` BIGINT UNSIGNED NOT NULL,
  `producto_version_id` BIGINT UNSIGNED NOT NULL,
  `cantidad_solicitada` DECIMAL(20,6) NOT NULL,
  `cantidad_aprobada` DECIMAL(20,6) NULL,
  `cantidad_cancelada` DECIMAL(20,6) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_alistamiento_detalles_1` (`cliente_id`, `solicitud_id`, `id`),
  UNIQUE KEY `uq_alistamiento_detalles_2` (`solicitud_id`, `referencia_stock_id`),
  CONSTRAINT `ck_alistamiento_detalles_1` CHECK (cantidad_solicitada > 0),
  CONSTRAINT `ck_alistamiento_detalles_2` CHECK (cantidad_aprobada IS NULL OR (cantidad_aprobada >= 0 AND cantidad_aprobada <= cantidad_solicitada)),
  CONSTRAINT `ck_alistamiento_detalles_3` CHECK (cantidad_cancelada >= 0 AND cantidad_cancelada <= cantidad_solicitada),
  CONSTRAINT `ck_alistamiento_detalles_4` CHECK (cantidad_aprobada IS NULL OR cantidad_cancelada <= cantidad_aprobada)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- Fase 5 / Alistamientos: Una preparación concreta. Se crea al iniciar, no al aprobar. Sus referencias remotas se completan solo con confirmación WMS.
CREATE TABLE `externalclientes`.`ejecuciones_alistamiento` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `cliente_id` BIGINT UNSIGNED NOT NULL,
  `solicitud_id` BIGINT UNSIGNED NOT NULL,
  `numero_ejecucion` INT UNSIGNED NOT NULL,
  `revision_aprobada` INT UNSIGNED NOT NULL,
  `estado_operativo` ENUM('ESPERANDO_WMS','EN_PREPARACION','LISTA','CANCELACION_SOLICITADA','CANCELADA','SALIDA_CONFIRMADA') NOT NULL DEFAULT 'ESPERANDO_WMS',
  `wms_alistamiento_id` INT NULL,
  `wms_salida_id` INT NULL,
  `iniciado_por_actor_id` BIGINT UNSIGNED NOT NULL,
  `inicio_solicitado_at` DATETIME(6) NOT NULL,
  `preparacion_confirmada_at` DATETIME(6) NULL,
  `listo_por_actor_id` BIGINT UNSIGNED NULL,
  `listo_at` DATETIME(6) NULL,
  `salida_confirmada_at` DATETIME(6) NULL,
  `version_lock` INT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ejecuciones_alistamiento_1` (`solicitud_id`, `numero_ejecucion`),
  UNIQUE KEY `uq_ejecuciones_alistamiento_2` (`cliente_id`, `solicitud_id`, `id`),
  UNIQUE KEY `uq_ejecuciones_alistamiento_3` (`wms_alistamiento_id`),
  UNIQUE KEY `uq_ejecuciones_alistamiento_4` (`wms_salida_id`),
  CONSTRAINT `ck_ejecuciones_alistamiento_1` CHECK (numero_ejecucion > 0 AND version_lock > 0),
  CONSTRAINT `ck_ejecuciones_alistamiento_2` CHECK (estado_operativo NOT IN ('EN_PREPARACION','LISTA','SALIDA_CONFIRMADA') OR (wms_alistamiento_id IS NOT NULL AND preparacion_confirmada_at IS NOT NULL)),
  CONSTRAINT `ck_ejecuciones_alistamiento_3` CHECK (estado_operativo <> 'LISTA' OR (listo_at IS NOT NULL AND listo_por_actor_id IS NOT NULL)),
  CONSTRAINT `ck_ejecuciones_alistamiento_4` CHECK (estado_operativo <> 'SALIDA_CONFIRMADA' OR (wms_salida_id IS NOT NULL AND salida_confirmada_at IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- Fase 5 / Alistamientos: Fracción del pedido asignada a cada preparación. Las cantidades reales provienen de WMS; un exceso genera incidencia, no se oculta.
CREATE TABLE `externalclientes`.`ejecucion_alistamiento_detalles` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `cliente_id` BIGINT UNSIGNED NOT NULL,
  `solicitud_id` BIGINT UNSIGNED NOT NULL,
  `ejecucion_id` BIGINT UNSIGNED NOT NULL,
  `alistamiento_detalle_id` BIGINT UNSIGNED NOT NULL,
  `cantidad_planificada` DECIMAL(20,6) NOT NULL,
  `cantidad_salida_confirmada` DECIMAL(20,6) NULL,
  `confirmado_wms_at` DATETIME(6) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ejecucion_alistamiento_detalles_1` (`ejecucion_id`, `alistamiento_detalle_id`),
  CONSTRAINT `ck_ejecucion_alistamiento_detalles_1` CHECK (cantidad_planificada > 0),
  CONSTRAINT `ck_ejecucion_alistamiento_detalles_2` CHECK (cantidad_salida_confirmada IS NULL OR cantidad_salida_confirmada >= 0),
  CONSTRAINT `ck_ejecucion_alistamiento_detalles_3` CHECK ((cantidad_salida_confirmada IS NULL AND confirmado_wms_at IS NULL) OR (cantidad_salida_confirmada IS NOT NULL AND confirmado_wms_at IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- Fase 3 / Documentos: Archivo/version privada. No guardar binarios, URL pública ni PDF WMS con ubicaciones. El original WMS queda en WMS.
CREATE TABLE `externalclientes`.`documentos` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `cliente_id` BIGINT UNSIGNED NOT NULL,
  `grupo_versiones` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `numero_version` INT UNSIGNED NOT NULL,
  `origen` ENUM('CLIENTE','INTERNO','WMS') NOT NULL,
  `storage_key` VARCHAR(500) COLLATE utf8mb4_bin NOT NULL,
  `nombre_original` VARCHAR(250) NOT NULL,
  `mime_validado` VARCHAR(120) NOT NULL,
  `tamano_bytes` BIGINT UNSIGNED NOT NULL,
  `contenido_sha256` BINARY(32) NOT NULL,
  `estado_revision` ENUM('CUARENTENA','VALIDADO','RECHAZADO') NOT NULL DEFAULT 'CUARENTENA',
  `apto_cliente` BOOLEAN NOT NULL DEFAULT FALSE,
  `cargado_por_actor_id` BIGINT UNSIGNED NOT NULL,
  `revisado_por_actor_id` BIGINT UNSIGNED NULL,
  `revisado_at` DATETIME(6) NULL,
  `creado_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_documentos_1` (`cliente_id`, `id`),
  UNIQUE KEY `uq_documentos_2` (`cliente_id`, `grupo_versiones`, `numero_version`),
  UNIQUE KEY `uq_documentos_3` (`storage_key`),
  CONSTRAINT `ck_documentos_1` CHECK (numero_version > 0 AND tamano_bytes > 0),
  CONSTRAINT `ck_documentos_2` CHECK (apto_cliente = FALSE OR (estado_revision = 'VALIDADO' AND revisado_por_actor_id IS NOT NULL AND revisado_at IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- Fase 3 / Documentos: El adjunto pertenece a una solicitud o a un producto de ese cliente; ambos extremos deben ser de la misma empresa.
CREATE TABLE `externalclientes`.`documento_vinculos` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `cliente_id` BIGINT UNSIGNED NOT NULL,
  `documento_id` BIGINT UNSIGNED NOT NULL,
  `solicitud_id` BIGINT UNSIGNED NULL,
  `cliente_producto_id` BIGINT UNSIGNED NULL,
  `producto_id` BIGINT UNSIGNED NULL,
  `categoria` VARCHAR(80) NOT NULL,
  `creado_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_documento_vinculos_1` (`documento_id`, `solicitud_id`),
  UNIQUE KEY `uq_documento_vinculos_2` (`documento_id`, `cliente_producto_id`),
  CONSTRAINT `ck_documento_vinculos_1` CHECK ((solicitud_id IS NOT NULL AND cliente_producto_id IS NULL AND producto_id IS NULL) OR (solicitud_id IS NULL AND cliente_producto_id IS NOT NULL AND producto_id IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- Fase 1 / Auditoría: Bitácora append-only: altas, credenciales, decisiones, cambios de estado y resultados. La API pública proyecta solo campos autorizados.
CREATE TABLE `externalclientes`.`eventos_auditoria` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `cliente_id` BIGINT UNSIGNED NULL,
  `actor_id` BIGINT UNSIGNED NULL,
  `sesion_id` BIGINT UNSIGNED NULL,
  `solicitud_id` BIGINT UNSIGNED NULL,
  `correlation_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `codigo_evento` VARCHAR(100) NOT NULL,
  `entidad_tipo` VARCHAR(80) NOT NULL,
  `entidad_id` VARCHAR(250) NOT NULL,
  `estado_anterior` VARCHAR(80) NULL,
  `estado_nuevo` VARCHAR(80) NULL,
  `visibilidad` ENUM('INTERNA','CLIENTE') NOT NULL DEFAULT 'INTERNA',
  `mensaje_cliente` VARCHAR(500) NULL,
  `detalle_interno` JSON NULL,
  `ip_origen` VARCHAR(45) CHARACTER SET ascii NULL,
  `navegador` VARCHAR(500) NULL,
  `creado_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `ix_eventos_auditoria_1` (`cliente_id`, `solicitud_id`, `creado_at`),
  KEY `ix_eventos_auditoria_2` (`actor_id`, `creado_at`),
  KEY `ix_eventos_auditoria_3` (`correlation_id`),
  CONSTRAINT `ck_eventos_auditoria_1` CHECK ((sesion_id IS NULL AND solicitud_id IS NULL) OR cliente_id IS NOT NULL),
  CONSTRAINT `ck_eventos_auditoria_2` CHECK (visibilidad <> 'CLIENTE' OR (cliente_id IS NOT NULL AND mensaje_cliente IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- Fase 4 / Integración: Outbox transaccional con payload aprobado e inmutable. Cancelar pendiente y tomar envío compiten bajo bloqueo; en vuelo exige conciliación.
CREATE TABLE `externalclientes`.`envios_integracion` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `cliente_id` BIGINT UNSIGNED NOT NULL,
  `solicitud_id` BIGINT UNSIGNED NOT NULL,
  `revision_referencia` INT UNSIGNED NOT NULL,
  `precarga_lote_id` BIGINT UNSIGNED NULL,
  `ejecucion_id` BIGINT UNSIGNED NULL,
  `destino` ENUM('WMS','TAREAS') NOT NULL,
  `operacion` VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clave_idempotencia` VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `payload` JSON NOT NULL,
  `payload_sha256` BINARY(32) NOT NULL,
  `estado` ENUM('PENDIENTE','EN_ENVIO','CONFIRMADO','REINTENTAR','CONCILIAR','ERROR_FINAL','CANCELADO') NOT NULL DEFAULT 'PENDIENTE',
  `intentos` INT UNSIGNED NOT NULL DEFAULT 0,
  `proximo_intento_at` DATETIME(6) NULL,
  `bloqueo_token` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `bloqueado_hasta_at` DATETIME(6) NULL,
  `referencia_remota` VARCHAR(250) NULL,
  `ultimo_error_codigo` VARCHAR(100) NULL,
  `correlation_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `creado_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `actualizado_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_envios_integracion_1` (`destino`, `clave_idempotencia`),
  UNIQUE KEY `uq_envios_integracion_2` (`cliente_id`, `id`),
  KEY `ix_envios_integracion_1` (`estado`, `proximo_intento_at`, `id`),
  CONSTRAINT `ck_envios_integracion_1` CHECK (precarga_lote_id IS NULL OR ejecucion_id IS NULL),
  CONSTRAINT `ck_envios_integracion_2` CHECK (operacion <> 'IMPORTAR_PRECARGA' OR (destino = 'WMS' AND precarga_lote_id IS NOT NULL AND ejecucion_id IS NULL)),
  CONSTRAINT `ck_envios_integracion_3` CHECK (operacion <> 'INICIAR_PREPARACION' OR (destino = 'WMS' AND ejecucion_id IS NOT NULL AND precarga_lote_id IS NULL)),
  CONSTRAINT `ck_envios_integracion_4` CHECK ((bloqueo_token IS NULL AND bloqueado_hasta_at IS NULL) OR (bloqueo_token IS NOT NULL AND bloqueado_hasta_at IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- Fase 4 / Integración: Historial de cada intento; no almacenar cabeceras de autorización ni respuestas completas.
CREATE TABLE `externalclientes`.`intentos_integracion` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `cliente_id` BIGINT UNSIGNED NOT NULL,
  `envio_id` BIGINT UNSIGNED NOT NULL,
  `numero_intento` INT UNSIGNED NOT NULL,
  `iniciado_at` DATETIME(6) NOT NULL,
  `finalizado_at` DATETIME(6) NULL,
  `resultado` ENUM('EN_CURSO','CONFIRMADO','REINTENTABLE','DESCONOCIDO','RECHAZADO') NOT NULL DEFAULT 'EN_CURSO',
  `http_status` SMALLINT UNSIGNED NULL,
  `error_codigo` VARCHAR(100) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_intentos_integracion_1` (`envio_id`, `numero_intento`),
  CONSTRAINT `ck_intentos_integracion_1` CHECK (numero_intento > 0),
  CONSTRAINT `ck_intentos_integracion_2` CHECK (http_status IS NULL OR (http_status >= 100 AND http_status <= 599))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- Fase 3 / Integración: Deduplica operaciones de negocio del front. No usar para login ni guardar respuestas con contraseñas/cookies. No reemplaza la deduplicación remota WMS.
CREATE TABLE `externalclientes`.`comandos_idempotentes` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `cliente_id` BIGINT UNSIGNED NOT NULL,
  `actor_id` BIGINT UNSIGNED NOT NULL,
  `operacion` VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clave` VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `peticion_sha256` BINARY(32) NOT NULL,
  `estado` ENUM('EN_CURSO','COMPLETADO') NOT NULL DEFAULT 'EN_CURSO',
  `solicitud_id` BIGINT UNSIGNED NULL,
  `resultado_seguro` JSON NULL,
  `creado_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `expira_at` DATETIME(6) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_comandos_idempotentes_1` (`cliente_id`, `actor_id`, `operacion`, `clave`),
  KEY `ix_comandos_idempotentes_1` (`expira_at`),
  CONSTRAINT `ck_comandos_idempotentes_1` CHECK (expira_at > creado_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- FKs se añaden al final para admitir la referencia circular solicitud/revisión aprobada.

ALTER TABLE `externalclientes`.`actores` ADD CONSTRAINT `fk_actores_1` FOREIGN KEY (`cliente_id`) REFERENCES `externalclientes`.`clientes_vinculados` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`usuarios_externos` ADD CONSTRAINT `fk_usuarios_externos_1` FOREIGN KEY (`cliente_id`) REFERENCES `externalclientes`.`clientes_vinculados` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`usuarios_externos` ADD CONSTRAINT `fk_usuarios_externos_2` FOREIGN KEY (`cliente_id`, `actor_id`) REFERENCES `externalclientes`.`actores` (`cliente_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`usuarios_externos` ADD CONSTRAINT `fk_usuarios_externos_3` FOREIGN KEY (`creado_por_actor_id`) REFERENCES `externalclientes`.`actores` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`dispositivos` ADD CONSTRAINT `fk_dispositivos_1` FOREIGN KEY (`cliente_id`, `usuario_id`) REFERENCES `externalclientes`.`usuarios_externos` (`cliente_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`sesiones` ADD CONSTRAINT `fk_sesiones_1` FOREIGN KEY (`cliente_id`, `usuario_id`, `dispositivo_id`) REFERENCES `externalclientes`.`dispositivos` (`cliente_id`, `usuario_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`productos` ADD CONSTRAINT `fk_productos_1` FOREIGN KEY (`creado_por_actor_id`) REFERENCES `externalclientes`.`actores` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`producto_versiones` ADD CONSTRAINT `fk_producto_versiones_1` FOREIGN KEY (`producto_id`) REFERENCES `externalclientes`.`productos` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`producto_versiones` ADD CONSTRAINT `fk_producto_versiones_2` FOREIGN KEY (`creado_por_actor_id`) REFERENCES `externalclientes`.`actores` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`producto_versiones` ADD CONSTRAINT `fk_producto_versiones_3` FOREIGN KEY (`homologado_por_actor_id`) REFERENCES `externalclientes`.`actores` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`cliente_producto` ADD CONSTRAINT `fk_cliente_producto_1` FOREIGN KEY (`cliente_id`) REFERENCES `externalclientes`.`clientes_vinculados` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`cliente_producto` ADD CONSTRAINT `fk_cliente_producto_2` FOREIGN KEY (`producto_id`) REFERENCES `externalclientes`.`productos` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`cliente_producto` ADD CONSTRAINT `fk_cliente_producto_3` FOREIGN KEY (`creado_por_actor_id`) REFERENCES `externalclientes`.`actores` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`producto_equivalencia_wms` ADD CONSTRAINT `fk_producto_equivalencia_wms_1` FOREIGN KEY (`producto_version_id`) REFERENCES `externalclientes`.`producto_versiones` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`producto_equivalencia_wms` ADD CONSTRAINT `fk_producto_equivalencia_wms_2` FOREIGN KEY (`validado_por_actor_id`) REFERENCES `externalclientes`.`actores` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`referencias_stock_wms` ADD CONSTRAINT `fk_referencias_stock_wms_1` FOREIGN KEY (`cliente_id`) REFERENCES `externalclientes`.`clientes_vinculados` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`referencias_stock_wms` ADD CONSTRAINT `fk_referencias_stock_wms_2` FOREIGN KEY (`cliente_id`, `cliente_producto_id`, `producto_id`) REFERENCES `externalclientes`.`cliente_producto` (`cliente_id`, `id`, `producto_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`referencias_stock_wms` ADD CONSTRAINT `fk_referencias_stock_wms_3` FOREIGN KEY (`producto_id`, `producto_version_id`) REFERENCES `externalclientes`.`producto_versiones` (`producto_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`referencias_stock_wms` ADD CONSTRAINT `fk_referencias_stock_wms_4` FOREIGN KEY (`producto_version_id`, `wms_producto_id`) REFERENCES `externalclientes`.`producto_equivalencia_wms` (`producto_version_id`, `wms_producto_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`solicitudes` ADD CONSTRAINT `fk_solicitudes_1` FOREIGN KEY (`cliente_id`) REFERENCES `externalclientes`.`clientes_vinculados` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`solicitudes` ADD CONSTRAINT `fk_solicitudes_2` FOREIGN KEY (`creado_por_actor_id`) REFERENCES `externalclientes`.`actores` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`solicitudes` ADD CONSTRAINT `fk_solicitudes_3` FOREIGN KEY (`cliente_id`, `id`, `revision_aprobada`) REFERENCES `externalclientes`.`solicitud_revisiones` (`cliente_id`, `solicitud_id`, `numero_revision`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`solicitud_revisiones` ADD CONSTRAINT `fk_solicitud_revisiones_1` FOREIGN KEY (`cliente_id`, `solicitud_id`) REFERENCES `externalclientes`.`solicitudes` (`cliente_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`solicitud_revisiones` ADD CONSTRAINT `fk_solicitud_revisiones_2` FOREIGN KEY (`enviado_por_actor_id`) REFERENCES `externalclientes`.`actores` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`decisiones_solicitud` ADD CONSTRAINT `fk_decisiones_solicitud_1` FOREIGN KEY (`cliente_id`, `solicitud_id`, `numero_revision`) REFERENCES `externalclientes`.`solicitud_revisiones` (`cliente_id`, `solicitud_id`, `numero_revision`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`decisiones_solicitud` ADD CONSTRAINT `fk_decisiones_solicitud_2` FOREIGN KEY (`decidido_por_actor_id`) REFERENCES `externalclientes`.`actores` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`programaciones` ADD CONSTRAINT `fk_programaciones_1` FOREIGN KEY (`cliente_id`, `solicitud_id`) REFERENCES `externalclientes`.`solicitudes` (`cliente_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`programaciones` ADD CONSTRAINT `fk_programaciones_2` FOREIGN KEY (`creado_por_actor_id`) REFERENCES `externalclientes`.`actores` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`programaciones` ADD CONSTRAINT `fk_programaciones_3` FOREIGN KEY (`confirmado_por_actor_id`) REFERENCES `externalclientes`.`actores` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`precargas` ADD CONSTRAINT `fk_precargas_1` FOREIGN KEY (`cliente_id`, `solicitud_id`, `tipo_solicitud`) REFERENCES `externalclientes`.`solicitudes` (`cliente_id`, `id`, `tipo`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`solicitudes_servicio` ADD CONSTRAINT `fk_solicitudes_servicio_1` FOREIGN KEY (`cliente_id`, `solicitud_id`, `tipo_solicitud`) REFERENCES `externalclientes`.`solicitudes` (`cliente_id`, `id`, `tipo`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`precarga_lotes` ADD CONSTRAINT `fk_precarga_lotes_1` FOREIGN KEY (`cliente_id`, `solicitud_id`) REFERENCES `externalclientes`.`precargas` (`cliente_id`, `solicitud_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`precarga_detalles` ADD CONSTRAINT `fk_precarga_detalles_1` FOREIGN KEY (`cliente_id`, `solicitud_id`, `precarga_lote_id`) REFERENCES `externalclientes`.`precarga_lotes` (`cliente_id`, `solicitud_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`precarga_detalles` ADD CONSTRAINT `fk_precarga_detalles_2` FOREIGN KEY (`cliente_id`, `cliente_producto_id`, `producto_id`) REFERENCES `externalclientes`.`cliente_producto` (`cliente_id`, `id`, `producto_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`precarga_detalles` ADD CONSTRAINT `fk_precarga_detalles_3` FOREIGN KEY (`producto_id`, `producto_version_id`) REFERENCES `externalclientes`.`producto_versiones` (`producto_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`recepciones_wms` ADD CONSTRAINT `fk_recepciones_wms_1` FOREIGN KEY (`cliente_id`, `solicitud_id`) REFERENCES `externalclientes`.`precargas` (`cliente_id`, `solicitud_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`recepcion_detalles_wms` ADD CONSTRAINT `fk_recepcion_detalles_wms_1` FOREIGN KEY (`cliente_id`, `solicitud_id`, `recepcion_id`) REFERENCES `externalclientes`.`recepciones_wms` (`cliente_id`, `solicitud_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`recepcion_detalles_wms` ADD CONSTRAINT `fk_recepcion_detalles_wms_2` FOREIGN KEY (`cliente_id`, `solicitud_id`, `precarga_detalle_id`, `producto_version_id`) REFERENCES `externalclientes`.`precarga_detalles` (`cliente_id`, `solicitud_id`, `id`, `producto_version_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`recepcion_detalles_wms` ADD CONSTRAINT `fk_recepcion_detalles_wms_3` FOREIGN KEY (`producto_version_id`) REFERENCES `externalclientes`.`producto_versiones` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`recepcion_detalles_wms` ADD CONSTRAINT `fk_recepcion_detalles_wms_4` FOREIGN KEY (`cliente_id`, `referencia_stock_id`, `producto_version_id`) REFERENCES `externalclientes`.`referencias_stock_wms` (`cliente_id`, `id`, `producto_version_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`incidencias_solicitud` ADD CONSTRAINT `fk_incidencias_solicitud_1` FOREIGN KEY (`cliente_id`, `solicitud_id`) REFERENCES `externalclientes`.`solicitudes` (`cliente_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`incidencias_solicitud` ADD CONSTRAINT `fk_incidencias_solicitud_2` FOREIGN KEY (`creado_por_actor_id`) REFERENCES `externalclientes`.`actores` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`incidencias_solicitud` ADD CONSTRAINT `fk_incidencias_solicitud_3` FOREIGN KEY (`resuelto_por_actor_id`) REFERENCES `externalclientes`.`actores` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`alistamientos` ADD CONSTRAINT `fk_alistamientos_1` FOREIGN KEY (`cliente_id`, `solicitud_id`, `tipo_solicitud`) REFERENCES `externalclientes`.`solicitudes` (`cliente_id`, `id`, `tipo`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`alistamiento_detalles` ADD CONSTRAINT `fk_alistamiento_detalles_1` FOREIGN KEY (`cliente_id`, `solicitud_id`) REFERENCES `externalclientes`.`alistamientos` (`cliente_id`, `solicitud_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`alistamiento_detalles` ADD CONSTRAINT `fk_alistamiento_detalles_2` FOREIGN KEY (`cliente_id`, `referencia_stock_id`, `producto_version_id`) REFERENCES `externalclientes`.`referencias_stock_wms` (`cliente_id`, `id`, `producto_version_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`ejecuciones_alistamiento` ADD CONSTRAINT `fk_ejecuciones_alistamiento_1` FOREIGN KEY (`cliente_id`, `solicitud_id`) REFERENCES `externalclientes`.`alistamientos` (`cliente_id`, `solicitud_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`ejecuciones_alistamiento` ADD CONSTRAINT `fk_ejecuciones_alistamiento_2` FOREIGN KEY (`cliente_id`, `solicitud_id`, `revision_aprobada`) REFERENCES `externalclientes`.`solicitud_revisiones` (`cliente_id`, `solicitud_id`, `numero_revision`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`ejecuciones_alistamiento` ADD CONSTRAINT `fk_ejecuciones_alistamiento_3` FOREIGN KEY (`iniciado_por_actor_id`) REFERENCES `externalclientes`.`actores` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`ejecuciones_alistamiento` ADD CONSTRAINT `fk_ejecuciones_alistamiento_4` FOREIGN KEY (`listo_por_actor_id`) REFERENCES `externalclientes`.`actores` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`ejecucion_alistamiento_detalles` ADD CONSTRAINT `fk_ejecucion_alistamiento_detalles_1` FOREIGN KEY (`cliente_id`, `solicitud_id`, `ejecucion_id`) REFERENCES `externalclientes`.`ejecuciones_alistamiento` (`cliente_id`, `solicitud_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`ejecucion_alistamiento_detalles` ADD CONSTRAINT `fk_ejecucion_alistamiento_detalles_2` FOREIGN KEY (`cliente_id`, `solicitud_id`, `alistamiento_detalle_id`) REFERENCES `externalclientes`.`alistamiento_detalles` (`cliente_id`, `solicitud_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`documentos` ADD CONSTRAINT `fk_documentos_1` FOREIGN KEY (`cliente_id`) REFERENCES `externalclientes`.`clientes_vinculados` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`documentos` ADD CONSTRAINT `fk_documentos_2` FOREIGN KEY (`cargado_por_actor_id`) REFERENCES `externalclientes`.`actores` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`documentos` ADD CONSTRAINT `fk_documentos_3` FOREIGN KEY (`revisado_por_actor_id`) REFERENCES `externalclientes`.`actores` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`documento_vinculos` ADD CONSTRAINT `fk_documento_vinculos_1` FOREIGN KEY (`cliente_id`, `documento_id`) REFERENCES `externalclientes`.`documentos` (`cliente_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`documento_vinculos` ADD CONSTRAINT `fk_documento_vinculos_2` FOREIGN KEY (`cliente_id`, `solicitud_id`) REFERENCES `externalclientes`.`solicitudes` (`cliente_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`documento_vinculos` ADD CONSTRAINT `fk_documento_vinculos_3` FOREIGN KEY (`cliente_id`, `cliente_producto_id`, `producto_id`) REFERENCES `externalclientes`.`cliente_producto` (`cliente_id`, `id`, `producto_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`eventos_auditoria` ADD CONSTRAINT `fk_eventos_auditoria_1` FOREIGN KEY (`cliente_id`) REFERENCES `externalclientes`.`clientes_vinculados` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`eventos_auditoria` ADD CONSTRAINT `fk_eventos_auditoria_2` FOREIGN KEY (`actor_id`) REFERENCES `externalclientes`.`actores` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`eventos_auditoria` ADD CONSTRAINT `fk_eventos_auditoria_3` FOREIGN KEY (`cliente_id`, `sesion_id`) REFERENCES `externalclientes`.`sesiones` (`cliente_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`eventos_auditoria` ADD CONSTRAINT `fk_eventos_auditoria_4` FOREIGN KEY (`cliente_id`, `solicitud_id`) REFERENCES `externalclientes`.`solicitudes` (`cliente_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`envios_integracion` ADD CONSTRAINT `fk_envios_integracion_1` FOREIGN KEY (`cliente_id`, `solicitud_id`, `revision_referencia`) REFERENCES `externalclientes`.`solicitud_revisiones` (`cliente_id`, `solicitud_id`, `numero_revision`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`envios_integracion` ADD CONSTRAINT `fk_envios_integracion_2` FOREIGN KEY (`cliente_id`, `solicitud_id`, `precarga_lote_id`) REFERENCES `externalclientes`.`precarga_lotes` (`cliente_id`, `solicitud_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`envios_integracion` ADD CONSTRAINT `fk_envios_integracion_3` FOREIGN KEY (`cliente_id`, `solicitud_id`, `ejecucion_id`) REFERENCES `externalclientes`.`ejecuciones_alistamiento` (`cliente_id`, `solicitud_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`intentos_integracion` ADD CONSTRAINT `fk_intentos_integracion_1` FOREIGN KEY (`cliente_id`, `envio_id`) REFERENCES `externalclientes`.`envios_integracion` (`cliente_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`comandos_idempotentes` ADD CONSTRAINT `fk_comandos_idempotentes_1` FOREIGN KEY (`cliente_id`) REFERENCES `externalclientes`.`clientes_vinculados` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`comandos_idempotentes` ADD CONSTRAINT `fk_comandos_idempotentes_2` FOREIGN KEY (`actor_id`) REFERENCES `externalclientes`.`actores` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `externalclientes`.`comandos_idempotentes` ADD CONSTRAINT `fk_comandos_idempotentes_3` FOREIGN KEY (`cliente_id`, `solicitud_id`) REFERENCES `externalclientes`.`solicitudes` (`cliente_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Comprobación al finalizar: deben aparecer 31 tablas y 69 claves foráneas.
SELECT VERSION() AS version_servidor,
       DATABASE() AS base_destino,
       (SELECT COUNT(*) FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = 'externalclientes' AND TABLE_TYPE = 'BASE TABLE') AS tablas,
       (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
         WHERE CONSTRAINT_SCHEMA = 'externalclientes') AS claves_foraneas;
