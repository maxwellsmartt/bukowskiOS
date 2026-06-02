# Reporte de auditoria de seguridad - bukowskiOS

Fecha: 2026-06-02

## Resumen ejecutivo

Se configuro la automatizacion semanal de auditoria y se hizo una corrida manual de prueba.

Resultado principal: encontre y corregi un riesgo de fuga/borrado de archivos locales causado por rutas persistidas en SQLite/Supabase (`storage_path`) que algunas pantallas usaban para previews o limpieza sin revalidar la raiz permitida.

Impacto real: si una fila local o sincronizada quedaba manipulada, bukowskiOS podia intentar leer como preview un archivo pequeno fuera del storage permitido, o borrar un attachment fuera de la carpeta de attachments durante limpieza. No encontre evidencia de secretos reales hardcodeados en el codigo revisado ni de un bypass directo de IPC: los handlers usan validacion de sender y sanitizacion de errores.

Estado: corregido en esta prueba manual.

## Hallazgos

### SEC-001 - medio - Lectura de archivos locales via `storage_path` contaminado

Superficie afectada:
- Previews de archivos de assets.
- Documentos de catalogo/crew.
- Documentos financieros.
- Cache local de branding.

Evidencia:
- Antes de la correccion, varias lecturas usaban `fs.readFileSync(row.storage_path)` o equivalente despues de consultar SQLite.
- Los puntos corregidos ahora validan con `assertPathWithinRoot` antes de leer:
  - `apps/desktop/electron/main/services/data/assetReadService.ts:89`
  - `apps/desktop/electron/main/services/data/assetReadService.ts:693`
  - `apps/desktop/electron/main/services/data/catalogReadService.ts:55`
  - `apps/desktop/electron/main/services/data/catalogReadService.ts:297`
  - `apps/desktop/electron/main/services/data/financeReadService.ts:92`
  - `apps/desktop/electron/main/services/data/financeReadService.ts:444`
  - `apps/desktop/electron/main/services/data/workspaceBrandingAssetService.ts:118`
  - `apps/desktop/electron/main/services/data/workspaceBrandingAssetService.ts:192`

Consecuencia de no corregirlo:
Un atacante con capacidad de alterar datos persistidos, o un bug de sync que escriba una ruta maliciosa, podria hacer que la app lea un archivo local pequeno como preview. Ejemplo practico: apuntar una fila a un archivo privado dentro de la maquina y lograr que aparezca incrustado como `data:` en la UI.

Fix rapido aplicado:
Validar toda ruta persistida contra el storage root antes de leerla. Si no pasa la validacion, se trata como archivo faltante y no se genera preview.

Fix definitivo aplicado:
Se paso `getStorageRoot` desde `localDatabase` hacia los read services para usar la raiz real configurada por el usuario, no una suposicion fija.

Pruebas agregadas:
- `apps/desktop/src/test/file-upload-service.test.ts`: confirma que una ruta fuera del storage root no genera preview.
- `apps/desktop/src/test/workspace-branding-asset-service.test.ts`: confirma que `file://` y cache contaminado no leen archivos locales.

### SEC-002 - medio - Borrado de archivos fuera de la carpeta de attachments

Superficie afectada:
- Limpieza de threads de assistant chat.
- Retention cleanup de attachments antiguos.

Evidencia:
- Correccion en `apps/desktop/electron/main/services/data/assistantChatService.ts:261`
- Correccion en `apps/desktop/electron/main/services/data/assistantChatService.ts:744`
- Correccion en `apps/desktop/electron/main/services/data/dataRetentionService.ts:60`
- Correccion en `apps/desktop/electron/main/services/data/dataRetentionService.ts:98`

Consecuencia de no corregirlo:
Si una fila `assistant_chat_attachments.storage_path` quedaba manipulada, una limpieza normal podia borrar un archivo fuera de la carpeta esperada. Es un riesgo operativo serio porque convierte una tarea de mantenimiento en una accion destructiva sobre archivos locales.

Fix rapido aplicado:
Antes de `unlinkSync`, validar que el path resuelve dentro de `attachmentsRootPath`.

Fix definitivo aplicado:
`createDataRetentionService` ahora recibe `attachmentsRootPath` desde `localDatabase`, y `assistantChatService` usa `assertPathWithinRoot` antes de borrar.

Pruebas agregadas:
- `apps/desktop/src/test/data-retention-service.test.ts`: confirma que retention no borra archivos fuera de attachments root.
- `apps/desktop/src/test/assistant-chat-service.test.ts`: sigue pasando el flujo normal de missing attachments y delete.

### SEC-003 - bajo - Falso positivo en `pathSafety` con archivos missing bajo rutas symlink

Superficie afectada:
- Validacion de paths cuando el archivo ya fue borrado pero su carpeta padre existe.

Evidencia:
- Correccion en `apps/desktop/electron/main/security/pathSafety.ts:25`

Consecuencia de no corregirlo:
Podia marcar como insegura una ruta valida cuando macOS resolvia `/var/...` contra `/private/var/...`. Esto no era una fuga directa, pero podia generar estados confusos de "archivo fuera de workspace" en archivos que solo estaban missing.

Fix aplicado:
Cuando el target no existe, se resuelve el directorio padre real y se concatena el basename. Asi se mantiene la proteccion contra traversal/symlink sin falsos positivos comunes en macOS.

## Verificaciones ejecutadas

- `corepack pnpm --filter @bukowski/desktop typecheck`: pasa.
- `corepack pnpm --filter @bukowski/desktop test -- file-upload-service.test.ts data-retention-service.test.ts workspace-branding-asset-service.test.ts assistant-chat-service.test.ts security-config.test.ts`: pasa.
- Resultado de Vitest en la corrida focalizada: 46 archivos, 237 tests, todos pasan.

## Riesgo residual

- medio: conviene extender esta misma validacion a cualquier nuevo uso futuro de `storage_path`. La deuda tecnica aqui era inconsistencia: algunos servicios ya estaban protegidos y otros no.
- medio: la auditoria manual no hizo pentest dinamico con app Electron corriendo ni verificacion remota de Supabase/RLS porque esta prueba se mantuvo local y no destructiva.

## Proxima fase recomendada

MVP completado:
- Automatizacion creada.
- Primera corrida manual hecha.
- Hallazgos corregidos y cubiertos con tests.

Hardening siguiente:
- Revisar todas las migraciones Supabase con foco en RLS y grants.
- Revisar IPC domain-by-domain para confirmar que todo write path valida workspace y permisos.
- Agregar un test de regresion global que busque `readFileSync(row.storage_path)` / `unlinkSync(row.storage_path)` sin `assertPathWithinRoot`.

Optimizacion:
- Convertir este reporte en plantilla fija de la automatizacion semanal para que siempre entregue: resumen ejecutivo, hallazgos por impacto, fixes aplicados, pruebas y deuda tecnica.
