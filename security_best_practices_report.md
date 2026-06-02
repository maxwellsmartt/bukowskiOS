# Reporte de auditoria de seguridad - bukowskiOS

Fecha: 2026-06-02

## Resumen ejecutivo

Se convirtio la auditoria semanal en una automatizacion con plantilla fija de reporte: resumen ejecutivo, hallazgos por impacto, fixes aplicados, pruebas/verificaciones y deuda tecnica.

En esta fase se cerro el hardening propuesto de forma local y auditable: se revisaron migraciones Supabase con foco en RLS/grants, se reviso IPC domain-by-domain para write paths, y se agrego un test de regresion global contra lecturas/borrados inseguros de `storage_path`.

Resultado principal nuevo: se encontro y corrigio una brecha `medio` en IPC de Agents/AI/Connectors. Los handlers usaban `safeHandle` (sender + schema), pero varios writes no validaban workspace/permisos antes de mutar configuracion local de agentes, providers, conectores o chat.

Estado general: los hallazgos corregibles sin cambio de arquitectura quedaron corregidos y cubiertos por tests. No se hizo pentest remoto ni ejecucion contra Supabase productivo.

Riesgo residual mas importante: las funciones Supabase `SECURITY DEFINER` siguen en schema `public`; moverlas a un schema privado es hardening recomendado, pero requiere migracion coordinada de policies.

## Hallazgos por impacto

### Blocker

No se encontraron blockers en la auditoria local.

### Critico

No se encontraron criticos explotables directamente en el alcance local revisado.

### Medio

#### SEC-001 - medio - Lectura de archivos locales via `storage_path` contaminado

Superficie afectada:
- Previews de archivos de assets.
- Documentos de catalogo/crew.
- Documentos financieros.
- Cache local de branding.

Evidencia:
- Antes de la correccion, varias lecturas usaban `fs.readFileSync(row.storage_path)` o equivalente despues de consultar SQLite.
- Los puntos corregidos validan con `assertPathWithinRoot` antes de leer:
  - `apps/desktop/electron/main/services/data/assetReadService.ts:89`
  - `apps/desktop/electron/main/services/data/assetReadService.ts:693`
  - `apps/desktop/electron/main/services/data/catalogReadService.ts:55`
  - `apps/desktop/electron/main/services/data/catalogReadService.ts:297`
  - `apps/desktop/electron/main/services/data/financeReadService.ts:92`
  - `apps/desktop/electron/main/services/data/financeReadService.ts:444`
  - `apps/desktop/electron/main/services/data/workspaceBrandingAssetService.ts:118`
  - `apps/desktop/electron/main/services/data/workspaceBrandingAssetService.ts:192`

Consecuencia de no corregirlo:
Un actor con capacidad de alterar datos persistidos, o un bug de sync que escriba una ruta maliciosa, podria hacer que la app lea un archivo local pequeno como preview.

Fix rapido aplicado:
Validar toda ruta persistida contra el storage root antes de leerla. Si no pasa la validacion, se trata como archivo faltante y no se genera preview.

Fix definitivo aplicado:
Se paso `getStorageRoot` desde `localDatabase` hacia los read services para usar la raiz real configurada por el usuario.

Estado:
Corregido y cubierto por tests.

#### SEC-002 - medio - Borrado de archivos fuera de la carpeta de attachments

Superficie afectada:
- Limpieza de threads de assistant chat.
- Retention cleanup de attachments antiguos.

Evidencia:
- `apps/desktop/electron/main/services/data/assistantChatService.ts:261`
- `apps/desktop/electron/main/services/data/assistantChatService.ts:744`
- `apps/desktop/electron/main/services/data/dataRetentionService.ts:60`
- `apps/desktop/electron/main/services/data/dataRetentionService.ts:98`

Consecuencia de no corregirlo:
Si una fila `assistant_chat_attachments.storage_path` quedaba manipulada, una limpieza normal podia borrar un archivo fuera de la carpeta esperada.

Fix aplicado:
Antes de `unlinkSync`, validar que el path resuelve dentro de `attachmentsRootPath`.

Estado:
Corregido y cubierto por tests.

#### SEC-003 - medio - IPC de Agents/AI/Connectors sin guard de workspace/permisos en write handlers

Superficie afectada:
- Crear/editar/pausar agentes.
- Guardar o probar providers de AI.
- Guardar/probar conectores.
- Crear link tokens de conectores.
- Asignar modelos.
- Crear/enviar/renombrar/borrar threads de assistant chat.
- Revisar agent runs y crear draft runs.

Evidencia:
- El wrapper `safeHandle` valida sender y schema, pero el bloque de Agents antes llamaba directo a `agentMutations.*`.
- Guard agregado en:
  - `apps/desktop/electron/main/ipc/registerFoundationIpc.ts:704`
  - `apps/desktop/electron/main/ipc/registerFoundationIpc.ts:716`
  - `apps/desktop/electron/main/ipc/registerFoundationIpc.ts:778`
  - `apps/desktop/electron/main/ipc/registerFoundationIpc.ts:799`
  - `apps/desktop/electron/main/ipc/registerFoundationIpc.ts:838`

Consecuencia de no corregirlo:
Un renderer autenticado pero mal encaminado, o un bug de UI que envie `workspaceId` incorrecto, podia mutar configuracion local de agents/providers/connectors sin que IPC verificara membresia/permisos en ese workspace.

Fix aplicado:
Se agregaron `assertAgentWorkspaceAccess` y `assertAgentAdminAccess`. Los writes administrativos usan el permiso admin existente `users.invite`; chat/agent runs usan verificacion de membresia/write workspace.

Deuda tecnica asociada:
`users.invite` funciona como permiso admin existente, pero no es semanticamente ideal. El fix estructural recomendado es crear y sembrar `agents.manage` en roles locales/remotos y migrar estos checks a ese permiso.

Estado:
Corregido en IPC y cubierto por test de regresion.

#### SEC-004 - medio - Funciones Supabase `SECURITY DEFINER` en schema publico

Superficie afectada:
- `public.is_workspace_member`
- `public.has_permission`
- Policies RLS que dependen de esas funciones.

Evidencia:
- `supabase/migrations/0001_foundation.sql:115`
- `supabase/migrations/0001_foundation.sql:131`

Consecuencia de no corregirlo:
Supabase recomienda evitar funciones `SECURITY DEFINER` en schemas expuestos. Aunque estas funciones son intencionales para auth/RLS, vivir en `public` aumenta la superficie y hace mas facil que futuras grants/configuraciones las expongan de forma no deseada.

Fix rapido:
Mantener las funciones como estan, pero seguir auditando grants y RLS con tests estaticos.

Fix definitivo recomendado:
Crear schema privado para funciones de autorizacion, mover o duplicar estas funciones alli, actualizar policies para llamar el schema privado, revocar ejecucion innecesaria y verificar con SQL remoto.

Estado:
Abierto por requerir migracion Supabase coordinada y verificacion remota.

### Bajo

#### SEC-005 - bajo - Falso positivo en `pathSafety` con archivos missing bajo rutas symlink

Superficie afectada:
- Validacion de paths cuando el archivo ya fue borrado pero su carpeta padre existe.

Evidencia:
- `apps/desktop/electron/main/security/pathSafety.ts:25`

Consecuencia de no corregirlo:
Podia marcar como insegura una ruta valida cuando macOS resolvia `/var/...` contra `/private/var/...`.

Fix aplicado:
Cuando el target no existe, se resuelve el directorio padre real y se concatena el basename.

Estado:
Corregido.

## Fixes aplicados

- Automatizacion semanal actualizada con plantilla fija y checks obligatorios: Supabase RLS/grants, IPC write paths, `storage_path`/filesystem y secretos.
- IPC Agents/AI/Connectors: agregado guard de workspace/permisos antes de mutaciones en `registerFoundationIpc`.
- Regression test global: agregado `apps/desktop/src/test/security-regression.test.ts`.
- Supabase static audit test: el test confirma que tablas publicas con grants a `authenticated` tienen RLS habilitado por migracion directa o por el assert defensivo de `20260527200000_rls_enable_assert.sql`.
- Filesystem static audit test: el test falla si reaparece `readFileSync`, `unlinkSync` u `openPath` sobre `row.storage_path`/`attachment.storage_path` sin guard cercano.

## Pruebas y verificaciones

- `corepack pnpm --filter @bukowski/desktop typecheck`: pasa.
- `corepack pnpm --filter @bukowski/desktop test -- security-regression.test.ts workspace-access-guard.test.ts ipc-safe-handler.test.ts security-config.test.ts`: pasa.
- Resultado observado de Vitest: 47 archivos, 241 tests, todos pasan.

Cobertura real:
- TypeScript compila.
- IPC safe handler sigue validando sender/schema.
- Workspace access guard sigue bloqueando writes no autorizados.
- Supabase migration audit local verifica RLS/grants de forma estatica.
- No hay regresion directa de `storage_path` inseguro en `electron/main`.

No cubierto:
- No se ejecuto contra Supabase remoto/productivo.
- No se validaron policies con queries reales por usuario/rol.
- No se hizo pentest dinamico con la app Electron corriendo.

## Deuda tecnica y hardening pendiente

MVP completado:
- Plantilla fija de automatizacion.
- Revision local de Supabase migrations con test estatico.
- Revision IPC domain-by-domain con fix en Agents.
- Test de regresion global para `storage_path`.

Hardening siguiente:
- Crear permiso semantico `agents.manage` en seeds locales y migraciones Supabase, asignarlo a admin/supervisor segun producto y reemplazar el uso temporal de `users.invite`.
- Migrar funciones `SECURITY DEFINER` de `public` a un schema privado y actualizar policies.
- Ejecutar verificacion remota Supabase: listar tablas con grants, RLS, policies y funciones ejecutables por `anon/authenticated`.

Optimizacion:
- Convertir el reporte semanal en artifact versionado por fecha, por ejemplo `docs/security/security-audit-YYYY-MM-DD.md`, para mantener historial sin sobrescribir.

## Bloqueos o decisiones necesarias

- Para migrar `SECURITY DEFINER` fuera de `public` hace falta decidir ventana de migracion y validar en Supabase remoto.
- Para `agents.manage`, hace falta decidir que roles lo reciben por defecto: admin solamente, o admin + supervisor.
