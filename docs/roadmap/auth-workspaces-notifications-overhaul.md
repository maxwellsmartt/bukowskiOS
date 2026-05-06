# Auth, Workspaces, Archiving & Notifications Overhaul Roadmap

## Estado general

**In progress**

Este documento es la fuente viva de seguimiento para el overhaul de auth, users, workspaces, archiving y notifications. Debe actualizarse al iniciar/cerrar cada slice, al detectar riesgos, al diferir alcance y al correr verificaciones.

## Resumen ejecutivo

El trabajo avanza con estrategia **Vertical MVP primero**: Supabase como fuente de verdad, SQLite como cache local + outbox, auth profesional, workspace real y un flujo CRUD sincronizado antes del reemplazo completo de `DEFAULT_WORKSPACE_ID`.

Decisiones bloqueadas:

- Auth v1 incluye email/password, Google, GitHub y magic link.
- Roles de sistema son inmutables y clonables.
- No se empaqueta `service_role` en Electron. Operaciones admin viven en Edge Functions/RPC seguras.
- El roadmap vivo forma parte del Definition of Done de cada slice.

## Tabla por slice

| Slice | Estado | Inicio | Cierre | Owner | Evidencia de verificación |
| --- | --- | --- | --- | --- | --- |
| 0 — Foundation Supabase + Seguridad | In progress | 2026-04-15 |  | Codex | Dependencias instaladas; roadmap, paquete Supabase, Keychain IPC, deep links, migración y Edge Functions desplegadas. Migración validada con REST `workspaces` 200; functions responden `authentication_required`/`forbidden` sin sesión. Typecheck/build/tests pasan. |
| 1 — Auth + Workspace Vertical MVP | In progress | 2026-04-15 |  | Codex | Login real Supabase y creación real de workspace remoto validados en app. Providers/rutas/guardas/switcher creados. Assets/Packing/Incidents consumen active workspace y validan workspace access en main. Outbox async con transport Supabase opt-in. Workspaces remotos se cachean en SQLite local. Import CSV Rentman probado con CSV real, reconciliado localmente y con preview antes de escribir. Outbox de Metadata Cine2 drenó localmente a `sent=674` y Supabase confirmó `0-673/674`. Snapshots remotos de Assets quedaron en paridad con SQLite. Operational snapshots para Projects/Packing/Incidents/RMAs tienen backfill, pull con retry real y lookback de recuperación. Typecheck/build/tests pasan; typecheck volvió a pasar en casa. |
| 2 — Roles, Permissions e Invites | In progress | 2026-04-29 |  | Codex | Primer corte de Settings: navegación compacta, health cards, Data/Advanced más separados y Team usando workspace activo. |
| 3 — Workspaces CRUD + Sharing | Todo |  |  | Codex | Pendiente. |
| 4 — Archiving Wrapped-Gate | Todo |  |  | Codex | Pendiente. |
| 5 — Notifications, Todos y Reminders | Todo |  |  | Codex | Pendiente. |

## Checklist por slice

### Slice 0 — Foundation Supabase + Seguridad

- Done — Crear roadmap vivo en `docs/roadmap/auth-workspaces-notifications-overhaul.md`.
- Done — Agregar dependencias base: `@supabase/supabase-js`, `keytar`, `electron-store`, `sonner`, `date-fns-tz`.
- Done — Crear paquete `packages/supabase-client/` con cliente tipado y helpers de env.
- Done — Crear token store con Keychain vía `keytar`.
- Done — Configurar deep links `bukowskios://auth/*`.
- Done — Crear migración Supabase foundation inicial.
- Done — Crear Edge Functions stub para invites/bootstrap admin.
- Done — Correr typecheck/build y registrar resultado.
- Done — Validar migración contra un proyecto Supabase real.
- Done — Desplegar Edge Functions en entorno dev.

### Slice 1 — Auth + Workspace Vertical MVP

- Done — Crear `SessionProvider` con Supabase PKCE y fallback local-dev seguro.
- Done — Rehidratar sesión Supabase desde Keychain al arrancar.
- Done — Crear `WorkspaceProvider` con active workspace persistido y fallback `workspace-metadata`.
- Done — Crear pantallas login/recovery/MFA placeholder/workspace picker/create.
- Done — Agregar guards sesión/workspace sin romper el modo local actual.
- Done — Implementar workspace switch básico en top bar.
- Done — Conectar `WorkspaceCreateScreen` a la Edge Function `admin-workspace-bootstrap` cuando Supabase está configurado.
- Done — Validar flujo real en app: login Supabase -> create workspace -> workspace creado.
- Doing — Portar estética/login desde `checkbox_app` con más fidelidad visual.
- Done — Migrar lista/create/edit/archive de assets al workspace activo en SQLite local.
- Done — Convertir sync outbox worker a transport async injectable con retry/backoff preservado.
- Done — Agregar transport Supabase opt-in para auditar filas en `public.sync_outbox`.
- Done — Validar migración remota `sync_outbox` y activar `VITE_SUPABASE_SYNC_ENABLED=true` en dev.
- Done — Cachear memberships/workspaces Supabase en SQLite local para desbloquear writes workspace-scoped.
- Done — Import CSV de Assets MVP con soporte para export real Rentman en español, cantidades, duplicados internos y reintentos.
- Done — Reconciliar SQLite local de `Metadata Cine2` con seriales/filas fuente del CSV ya importado.
- Done — Validar que `sync_outbox` termine de drenar localmente para `Metadata Cine2`.
- Done — Validar en Supabase que las filas esperadas del outbox llegaron al remoto.
- Done — Agregar preview/resumen antes de importar CSV.
- Done — Agregar guard reusable `workspaceAccess` en main para validar workspace remoto con token Supabase, membership y permisos.
- Done — Aplicar validación workspace-scoped al vertical Assets en IPC: list/summary/overview/detail, create/update/archive/assign, attach/open files.
- Done — Extender validación workspace-scoped a Packing e Incidents, incluyendo filtros de read service por workspace activo.
- Done — Agregar migración Supabase y bootstrap admin para asegurar permisos operativos remotos (`assets`, `incidents`, `packing-slips`, `rma`, `finance`).
- Done — Extender validación workspace-scoped a Projects: list/detail/preview/create/update/archive/delete/units y wizard de setup.
- Todo — Conectar MFA TOTP real con Supabase MFA.
- Todo — Extender `workspaceAccess` a Finance, Catalog, RMA y Agents.

### Slice 2 — Roles, Permissions e Invites

- Todo — Roles de sistema inmutables y clonables.
- Doing — Refactor Settings en Members/Roles/Crew/Invitations.
- Todo — Implementar invite crew -> user.
- Todo — Enforcement UI + IPC + RLS.

### Slice 3 — Workspaces CRUD + Sharing

- Todo — Crear/editar/switch workspaces.
- Todo — Persistir active workspace en `electron-store`.
- Todo — Crear `workspace_transfers`.
- Todo — Move asset/crew con guard server-side.

### Slice 4 — Archiving Wrapped-Gate

- Todo — Formalizar project status.
- Todo — Archive solo si `wrapped`.
- Todo — Crear snapshot `project_archives`.
- Todo — Liberar assets/crew al archivar.
- Todo — Eliminar hard delete de UI.

### Slice 5 — Notifications, Todos y Reminders

- Todo — Crear tablas `notifications`, `todos`, `reminders`.
- Todo — Implementar provider/tray/badge/FAB.
- Todo — Scheduler reminders en main.
- Todo — Tools para agent runtime.

## Bitácora de cambios

| Fecha | Branch/commit | Cambio | Motivo |
| --- | --- | --- | --- |
| 2026-04-15 | Working tree | Se inicia Slice 0, se crea roadmap vivo y se instalan dependencias base. | Dejar constancia desde el primer cambio y habilitar infraestructura segura. |
| 2026-04-15 | Working tree | Se agrega paquete `@bukowski/supabase-client`, Keychain token store, IPC `bukowskiAuth`, deep links `bukowskios://auth/*`, migración foundation y Edge Function stubs. | Habilitar auth/Supabase sin exponer `service_role` en Electron. |
| 2026-04-15 | Working tree | Verificación: `corepack pnpm --filter @bukowski/desktop typecheck`, `corepack pnpm --filter @bukowski/desktop build`, y typecheck directo del paquete Supabase pasan. | Registrar evidencia mínima de Slice 0 antes de avanzar. |
| 2026-04-15 | Working tree | Se corrigió `assistantGatewayService.createDraftRun`, que insertaba 23 valores en 24 columnas de `agent_runs`. | La suite detectó un bug existente que bloqueaba 3 tests; se corrigió para mantener estabilidad antes de avanzar. |
| 2026-04-15 | Working tree | Verificación final: `corepack pnpm --filter @bukowski/desktop test` pasa con 26 archivos y 92 tests; typecheck y build vuelven a pasar. | Dejar evidencia completa del estado actual del Slice 0. |
| 2026-04-15 | Working tree | Se inicia Slice 1 foundation: `SessionProvider`, `WorkspaceProvider`, rutas auth/workspaces, guards y `WorkspaceSwitcher` en top bar con fallback local-dev. | Preparar la app para auth/workspace real sin bloquear el flujo single-user actual. |
| 2026-04-15 | Working tree | Verificación Slice 1 foundation: `corepack pnpm --filter @bukowski/desktop typecheck`, `build` y `test` pasan; tests: 26 archivos, 92 casos. | Confirmar que los providers/guards no rompen comportamiento existente. |
| 2026-04-15 | Working tree | Se conecta `WorkspaceCreateScreen` con `WorkspaceProvider.createWorkspace`, que invoca `admin-workspace-bootstrap`; se agrega rehidratación de sesión desde Keychain. | Pasar de placeholder a flujo remoto real conservando fallback local-dev seguro. |
| 2026-04-15 | Working tree | Verificación del flujo workspace create/session hydration: `corepack pnpm --filter @bukowski/desktop typecheck`, `test` y `build` pasan; tests: 26 archivos, 96 casos. | Registrar evidencia antes de commitear el micro-slice. |
| 2026-04-15 | Working tree | Se configura Supabase dev local con anon key en `apps/desktop/.env.local`, se protege `.env.local` en `.gitignore`, y se valida `public.workspaces` vía REST con respuesta 200. | Confirmar que la migración foundation ya existe en el proyecto Supabase dev sin exponer secretos admin. |
| 2026-04-15 | Working tree | Se validan Edge Functions desplegadas: `admin-workspace-bootstrap` responde `401 authentication_required` sin sesión; `send-invite` responde `403 forbidden` sin usuario con permisos. | Confirmar deploy y secretos con errores seguros antes de probar creación real de workspace. |
| 2026-04-15 | Working tree | Se corrige CSP para permitir el origin Supabase configurado y se agrega CORS preflight a `admin-workspace-bootstrap`/`send-invite`. | Desbloquear login y creación de workspace desde Electron dev sin abrir wildcards inseguros. |
| 2026-04-15 | Working tree | Se reemplaza validación JWT local en Edge Functions por lookup contra `/auth/v1/user` y se vuelve idempotente el bootstrap de workspace/rol/membership. | Soportar JWT `ES256` de Supabase y recuperarse de intentos parciales de creación. |
| 2026-04-15 | Working tree | Se detecta que el gateway de Supabase Edge Functions rechaza JWT `ES256` antes de ejecutar la función; se documenta `verify_jwt=false` para functions que validan bearer internamente. | Evitar doble validación JWT y mantener autorización explícita dentro de la función. |
| 2026-04-15 | Working tree | Usuario valida en app el flujo Supabase real: login exitoso y creación de workspace remoto después de desactivar gateway JWT verification. Verificación local: `typecheck` y `test` pasan; tests: 26 archivos, 96 casos. | Cerrar el riesgo principal del vertical MVP auth/workspace antes de avanzar a assets/outbox. |
| 2026-04-15 | Working tree | Assets empieza a respetar workspace activo: el renderer envía `workspaceId`, `getAssets` filtra por `assets.workspace_id` y create/update/archive/assign/packing slip usan el workspace activo. Verificación: `corepack pnpm --filter @bukowski/desktop test -- asset-mutation-service.test.ts` pasa con 26 archivos/97 tests; `typecheck` pasa. | Reducir riesgo del reemplazo de `DEFAULT_WORKSPACE_ID` con un vertical local verificable antes del push remoto a Supabase. |
| 2026-04-15 | Working tree | Se convierte `syncOutboxWorkerService` a async con transport injectable, se agrega `createSupabaseOutboxTransport`, migración `public.sync_outbox` con RLS por membership y bandera opt-in `VITE_SUPABASE_SYNC_ENABLED`. Verificación: `typecheck` pasa y `corepack pnpm --filter @bukowski/desktop test -- sync-outbox-worker-service.test.ts` pasa con 26 archivos/99 tests. | Preparar push remoto idempotente y auditable sin romper modo local ni activar red antes de aplicar migración remota. |
| 2026-04-15 | Working tree | Usuario aplica migración `20260415150000_sync_outbox_bridge.sql`; se valida REST `public.sync_outbox` con sesión guardada y respuesta 200. Se detecta que SQLite local solo tenía `workspace-metadata`, por lo que se agrega IPC `ensureLocalWorkspaces` y `WorkspaceProvider` cachea los workspaces Supabase en local. Verificación: `typecheck`, `build` y tests focalizados pasan; tras reiniciar dev, SQLite contiene `Metadata Cine2` con UUID remoto. | Evitar fallos de foreign key al crear assets con UUID remoto de workspace y mantener la cache local consistente antes de probar outbox real. |
| 2026-04-15 | Working tree | Se corrige inconsistencia reportada en Assets: el fallback local ya no muestra temporalmente assets de `workspace-metadata` cuando hay sesión Supabase, y `getAssetSummary`/`getAssetsOverview` aceptan `workspaceId` para que métricas y tabla usen el mismo scope. Verificación: `typecheck`, `build` y test de assets pasan. | Evitar parpadeo de datos cruzados y métricas engañosas en workspaces remotos vacíos. |
| 2026-04-15 | Working tree | Se completa el scope de las cards operativas de Assets (`overdueReturns`, `openPackingSlips`, `activeIncidents`, `maintenanceWatch`) por workspace y se agrega botón `Import CSV` junto a `New asset` con parser CSV local para first-run imports. Verificación: `typecheck`, `build` y tests focalizados pasan. | Evitar métricas globales en workspaces nuevos y dar una ruta práctica para cargar inventarios preexistentes. |
| 2026-04-15 | Working tree | Se valida el CSV real `Exportación_Equipos_20211015 (1).csv`: headers en español/Rentman (`Nombre (en la base de datos)`, `Código`, `Cantidad actual`, `Códigos QR`, `Ubicado en almacén`) no eran reconocidos. Se amplía el parser, se preserva `Cantidad actual` como `totalQuantity` y se evita error no manejado de `setStoredTokens`. Verificación: `typecheck`, `build` y tests focalizados pasan. | Convertir el import de un demo técnico a un first-run import tolerante con exportaciones reales. |
| 2026-04-15 | `f94e516` y previos | Se endurece import CSV de Assets: acepta cantidad cero, detecta duplicados aunque el error venga envuelto por IPC, salta códigos existentes en reintentos y mergea filas duplicadas internas por código conservando seriales/filas fuente en notes. Verificación: `typecheck`, `build` y tests focalizados pasan. | Evitar fallos en imports reales, no duplicar stock por filas serializadas y hacer reintentos idempotentes. |
| 2026-04-15 | Data repair local | Se crea backup SQLite `bukowski-foundation.pre-csv-reconcile-20260415.sqlite` y se reconcilia `Metadata Cine2`: 629 assets, stock total/disponible 1727, 45 assets actualizados con seriales/filas fuente, 2 ajustes de cantidad, 45 eventos `asset_csv_reconciled`. | Dejar consistente el workspace ya importado antes del handoff y mantener auditoría en `asset_events`/`sync_outbox`. |
| 2026-04-15 | `docs/handoff/2026-04-15-auth-workspaces-assets-handoff.md` | Se crea documento de handoff para continuar en otro thread con estado, commits, datos locales, riesgos, deuda y prompt sugerido. | Permitir continuidad del trabajo desde otra máquina/sesión sin perder contexto operativo. |
| 2026-04-15 | Working tree casa | Se aplica handoff en casa, se copia `.env.local` y SQLite, se aprueba build nativo de `keytar`, `sync_outbox` de `Metadata Cine2` drena a `sent=674`, Supabase confirma `0-673/674`, y se agrega preview de CSV antes de importar assets. Verificación: `corepack pnpm --filter @bukowski/desktop typecheck` pasa. | Continuar el Slice 1 sin escrituras ciegas de CSV y confirmar que la cola local/remota ya no queda pendiente. |
| 2026-04-15 | Working tree casa | Se endurece el sync remoto de assets: `createSupabaseOutboxTransport` ahora resuelve snapshots locales para filas `asset_event` y hace upsert idempotente en `public.assets`, `public.asset_current_state` y `public.asset_events` antes de confirmar `public.sync_outbox`. Se agrega migración `20260416003000_asset_sync_snapshots.sql` con RLS por workspace membership y prueba focalizada del transporte. Verificación: `corepack pnpm --filter @bukowski/desktop test -- sync-outbox-worker-service.test.ts`, `typecheck` y `build` pasan. | Dejar proyecciones remotas auditables y comparables contra SQLite sin depender solo del log crudo del outbox. |
| 2026-04-24 | Working tree casa | Se aplica la migración remota `20260416003000_asset_sync_snapshots.sql`, se valida una asignación real de asset end-to-end (`asset-695-mo0p70bb`) y se confirma escritura en `public.sync_outbox`, `public.assets`, `public.asset_current_state` y `public.asset_events` bajo RLS. Luego se ejecuta backfill idempotente con `scripts/backfill-supabase-asset-snapshots.mjs`: remoto queda con 629 assets, 629 current state rows y 675 asset events para `Metadata Cine2`. | Cerrar la comparabilidad SQLite/Supabase del vertical Assets Sync antes de pasar a seguridad/IPC de Slice 1. |
| 2026-04-24 | Working tree casa | Se agrega `workspaceAccess` en main con validación local de workspace, token Supabase, membership/permisos remotos vía `has_permission` y cache breve; se aplica al vertical Assets en IPC incluyendo lecturas, mutaciones y archivos. Verificación: `npm run test -- workspace-access-guard` pasa con 4 tests y `npm run typecheck` pasa. | Reducir el riesgo crítico de confiar en `workspaceId` del renderer antes de extender permisos al resto de dominios. |
| 2026-04-24 | Working tree casa | Se extiende `workspaceAccess` a Packing e Incidents; sus query contracts/read services ahora aceptan y filtran `workspaceId`, las páginas usan active workspace y el IPC valida permisos (`packing-slips.read/create`, `incidents.read/create`) antes de leer, mutar, exportar o abrir archivos. Se agrega migración Supabase `20260424190000_operational_permissions.sql` y bootstrap admin para permisos remotos. Verificación: `npm run test -- workspace-access-guard packing-mutation-service incident-mutation-service` y `npm run typecheck` pasan. | Cerrar los dominios operativos con mayor riesgo de writes cruzados después de Assets. |
| 2026-04-25 | Working tree casa | Usuario aplica en Supabase la migración `20260424190000_operational_permissions.sql`. Se ajusta `WorkspaceProvider` para no mostrar el workspace local como placeholder durante rehidratación remota, y se centra/suaviza el overlay de búsqueda global para reducir banding visual. Verificación: `npm run typecheck` y tests focalizados de workspace/Packing/Incidents pasan. | Evitar confusión en el picker y pulir la UX de comandos globales antes de seguir extendiendo guards. |
| 2026-04-25 | Working tree casa | Se extiende `workspaceAccess` a Projects: la lista filtra por `workspaceId`, detail/delete preview/mutaciones resuelven workspace desde `projectId`, create/project blueprint escriben en el workspace activo, el wizard/conflict preview usa el workspace activo y se agrega permiso remoto `projects.read/manage` vía migración `20260425113000_project_permissions.sql`. Verificación: `npm run typecheck` y `npm run test -- workspace-access-guard project-mutation-service foundation-read-service` pasan. | Cerrar navegación y acciones de proyectos antes de seguir con Finance/Catalog, reduciendo riesgo de mezcla entre workspaces. |
| 2026-04-28 | Working tree | Auditoría IC-1: Global Search ya estaba scoped y probado; se cerró fallback legacy de `projects.getCatalog` sin workspace, se scopeó `exportProjectBlueprintPdf` al workspace del blueprint y se reforzó metadata de kits en Catalog para no cruzar workspaces. Verificación: `corepack pnpm --filter @bukowski/desktop typecheck` y `corepack pnpm --filter @bukowski/desktop test -- foundation-read-service.test.ts ipc-safe-handler.test.ts` pasan con 27 archivos/116 tests. | Mantener el foco en el vertical Inventory Core y reducir riesgo de datos cruzados antes de Assign/Move. |
| 2026-04-28 | Working tree | IC-3 Assign/Move: se agrega bandeja operacional persistente en Assets, selección cross-search, cantidades default 1 editables antes de assign/packing, y `DataTable.pruneSelectionOnRowsChange=false` para este flujo. Verificación: `typecheck`, tests focalizados y `build` pasan. | Reducir fricción real detectada al recrear un packing slip manual y preparar el flujo para técnicos no técnicos. |
| 2026-04-29 | Working tree | Se retoma roadmap principal con Slice 2/UX1: primer polish de Settings, separación visual de General/Team/Data/Advanced, overview con health cards y mutaciones de Team contra workspace activo. Verificación: `npm run typecheck` pasa. | Convertir Settings en una superficie de producto usable y sacar herramientas técnicas del camino normal. |
| 2026-05-05 | Working tree | Auditoría de pilot readiness: se prioriza login/auth/multiusuario/sync completo y smoke operacional para Iván/Carlos antes de abrir features grandes. Se inicia polish de Sync Activity y controles repetidos: filtros extensos pasan a dropdown, Upload queue usa search consistente y los scrollbars/rails quedan más sutiles. | Reducir fricción real de operación y hacer que los estados de sync sean entendibles para usuarios no técnicos durante el piloto. |
| 2026-05-05 | Working tree | Se inicia sync operacional multiusuario para Projects, Packing Slips, Incidents y RMAs con `public.operational_snapshots`, transport Supabase, pull hook e IPC local. Download Coverage ahora los marca como activos y el outbox proyecta snapshots para `project`, `packing_slip`, `incident` y `rma_case`. Verificación: typecheck/build pasan; tests focalizados de sync/packing/incidents/RMA/workspace guard pasan. | Cerrar la deuda visible en Settings y permitir que usuarios del mismo workspace compartan datos operativos, no sólo assets/catalog. |
| 2026-05-05 | Supabase dev + working tree | Usuario confirma que corrió `20260505130000_operational_snapshots.sql`. Se registra la deuda siguiente: backfill de snapshots existentes, smoke con dos usuarios y polish UI de Settings/Sync/Quotes antes de entregar piloto. También se corrigen pills centrados, FAB separado del scrollbar y autocomplete visual propio para items de Quotes. | La migración ya no bloquea; el foco pasa a validación real y simplificación de superficies para usuarios no técnicos. |
| 2026-05-05 | Working tree | Se agrega backfill idempotente de snapshots operativos históricos desde Sync Activity: Projects, Packing Slips, Incidents y RMAs se recorren por workspace activo, se encolan como `snapshot_backfill`, se suben con `Run upload sync` automático y no se re-encolan si ya fueron enviados con el mismo `updated_at`. Se corrige además el bridge preload de `applyRemoteOperationalSnapshots`. Verificación: `operational-snapshot-service`, `sync-outbox-worker-service`, `typecheck` y `build` pasan. | Cerrar la brecha entre datos históricos locales y datos visibles para otros usuarios del workspace. |
| 2026-05-05 | Working tree | Se extiende `workspaceAccess` a Finance, Currency y Quotes. Finance overview/entries/cost links ahora reciben `workspaceId` desde renderer y los reads filtran por workspace; documentos financieros, currency settings/rates y quotes validan membership/permisos antes de leer, escribir o exportar. Verificación: `workspace-access-guard`, `finance-mutation-service`, `quote-read-service`, `quote-mutation-service`, `typecheck` y `build` pasan. | Reducir el riesgo de lectura/escritura cruzada fuera del vertical inventario antes del piloto. |
| 2026-05-06 | Working tree | Se investiga fallo real de Sync reportado para proyectos/contenido generado en casa. Logs locales muestran `FOREIGN KEY constraint failed` en `project-agt-motdjuvb`/`project-alr-mou1gvtx`, `FOREIGN KEY constraint failed` en `packing-1044`/`packing-1045` y `UNIQUE constraint failed` en items de `packing-1043`; además el cursor de pull había avanzado con errores. | Confirmar causa raíz antes de empaquetar para Iván/Carlos: los datos sí estaban en Supabase, pero el apply local podía fallar y dejar de reintentar. |
| 2026-05-06 | Working tree | Se corrige operational pull/apply: el cursor solo avanza por filas aplicadas o saltadas con seguridad, el renderer reconsulta una ventana de lookback de 14 días para recuperar cursores adelantados, Projects tolera referencias opcionales de catálogo aún no descargadas, Packing reintenta si falta project/unit y upsertea items por `(packing_slip_id, asset_id)`. Verificación: `corepack pnpm --filter @bukowski/desktop test -- operational-snapshot-service`, `typecheck` y `build` pasan; la suite ejecutó 36 archivos/167 tests. | Hacer el sync operacional idempotente, reintentable y recuperable en máquinas que ya habían quedado con cursor adelantado. |
| 2026-05-06 | Working tree | Se endurece apertura de ventana para builds instalados: bounds persistidos fuera de pantalla se descartan, la ventana hace fallback `show()` aunque no llegue `ready-to-show`, y `activate`/`second-instance` restauran, muestran y enfocan. | Reducir el caso reportado por Carlos: Dock icon activo pero UI invisible después de instalar en otra Mac. |
| 2026-05-06 | Working tree | Se regenera el icono macOS desde la nueva base `bukowskiOS-desktop-logo.png` exportada a ~1024px y se actualiza `build/icon.iconset` + `build/icon.icns`; se agrega packer local `generate-icns.cjs` para evitar fallos de `iconutil`. | Empaquetar con el logo nuevo y dejar un flujo reproducible para regenerar `.icns`. |
| 2026-05-06 | Local package | Se genera build interna arm64: `apps/desktop/dist-packaged/bukowskiOS-0.1.0-arm64.dmg` y `.zip`. `codesign --verify --deep --strict` pasa; `spctl` falla esperado porque no hay Developer ID/notarización. | Dejar artefacto interno para repetir prueba en Mac M4 con icono/window/sync hardening aplicado. |
| 2026-05-06 | Working tree | Segundo log de Carlos confirma que la ventana de startup ya aparece, pero la app queda detenida porque `apply project creation wizard migration` falla con `FOREIGN KEY constraint failed`. Se corrige el bootstrap local para no sembrar `production_companies` si el workspace demo aún no existe y para reconstruir `packing_slips` limpiando referencias huérfanas opcionales. Verificación: `typecheck`, `build` y `package:mac` pasan; DMG/ZIP arm64 regenerados. | Evitar que una instalación nueva/parcial quede atrapada en "Starting bukowskiOS" por datos locales incompletos antes de que el usuario pueda entrar. |
| 2026-05-06 | Supabase prod + working tree | Carlos puede entrar por magic link, pero queda sin workspace porque existía en Auth sin `workspace_membership`. Se aplica migración `user_profiles_email_and_member_read`, se redeploya `send-invite` para manejar usuarios ya registrados y se crea membership activa Admin para `carlos@metadatacine.com` en `Metadata Cine2`. La pantalla Workspace Members ahora prefiere datos remotos de Supabase para usar UUIDs reales en role/status. Verificación: `typecheck` y `build` pasan. | Desbloquear onboarding multiusuario real y corregir el bug donde Team mandaba IDs locales tipo `user-carlos...` a columnas UUID remotas. |
| 2026-05-06 | Supabase prod | Al mostrar roles remotos reales, se detecta que `admin-workspace-bootstrap` sólo había sembrado `Admin`. Se aplica migración `seed_operational_workspace_roles` para crear roles `Crew`, `Supervisor`, `Finance Viewer` y `Maintenance` en todos los workspaces existentes con permisos base. Verificación SQL: `Metadata Cine2` muestra 5 roles y conteos de permisos esperados. | Restaurar el modelo de permisos intuitivo para invites y cambios de rol en piloto multiusuario. |
| 2026-05-06 | Supabase Edge Functions + working tree | Se actualiza y redeploya `admin-workspace-bootstrap` para que futuros workspaces creen desde el inicio los roles Admin, Crew, Supervisor, Finance Viewer y Maintenance, junto con permisos base y asignación Admin al creator. Verificación: deploy version 6 activo, `typecheck` y `build` pasan. | Evitar repetir migraciones correctivas de roles en workspaces nuevos. |
| 2026-05-06 | Supabase Edge Functions + working tree | Se ajusta `send-invite` para usuarios Auth ya existentes: además de crear/actualizar membership activa, ahora dispara `signInWithOtp` con `shouldCreateUser=false` y deep link `bukowskios://auth/callback`. El cliente distingue `magicLinkSent` y muestra warning si el acceso se actualizó pero Supabase no pudo enviar email. Verificación: deploy `send-invite` version 7 activo, `typecheck` y `build` pasan. | Evitar mensajes engañosos de "invite sent" cuando el email ya existía y no se enviaba magic link. |
| 2026-05-06 | Supabase Edge Functions + working tree | Se mejora el onboarding: las superficies `/login`, `/login/reset-password`, `/workspaces/select` y `/workspaces/create` ya no muestran sidebar/subnav de app; login usa fondo premium con logo real, panel ambiental y copy orientado a operación. Los magic links para usuarios existentes ahora vuelven con `flow=first-login`, y `ResetPasswordScreen` permite crear password antes de abrir workspaces. `send-invite` fue redeployado como version 9 con validación bearer interna. Verificación: `corepack pnpm --filter @bukowski/desktop typecheck` y `build` pasan. | Hacer que primer login/invite sea entendible para usuarios como Carlos, sin que parezca una pantalla interna a medio cargar. |
| 2026-05-06 | Working tree | Se renombra el actor local `user-ops` a `AI Agent` (`ai-agent@bukowskios.local`) en seeds/bootstrap SQLite, conservando el ID para no romper auditoría ni tests existentes. | Separar visualmente acciones de agentes de usuarios humanos como Repair Ops sin una migración riesgosa de IDs. |

## Decisiones tomadas

- Supabase es source of truth; SQLite queda como cache local + outbox.
- Electron nunca contiene `service_role`.
- Edge Functions/RPC cubren operaciones admin como invites.
- Se conserva `DEFAULT_WORKSPACE_ID` solo en seeds/test fixtures durante la migración.
- Magic link queda dentro de auth v1.
- First login por invite debe permitir crear password antes de operar; el magic link de usuarios existentes usa `flow=first-login`.
- El actor `user-ops` se conserva como ID técnico compatible, pero su identidad visible local pasa a ser `AI Agent`.

## Alternativas descartadas

- Service role en Electron: descartado por riesgo crítico de extracción de secretos.
- Big-bang total sin vertical MVP: descartado por riesgo alto de bloquear testing temprano.
- Roles de sistema editables: descartado por riesgo operacional; se permiten clones.

## Riesgos

| Impacto | Riesgo | Mitigación | Estado |
| --- | --- | --- | --- |
| crítico | Exponer service role en Electron compromete toda la base. | Solo anon/JWT en app; admin por Edge Functions/RPC. | Abierto, mitigación aplicada en diseño. |
| crítico | Confiar en `workspaceId` del renderer permite acceso cruzado. | Validar sesión, membership y permisos en main/RLS. | Mitigado en Assets, Packing, Incidents, Projects, RMA, Catalog, Finance, Currency y Quotes; abierto para Agents y smoke manual final. |
| medio | `DEFAULT_WORKSPACE_ID` está distribuido y puede romper flujos. | Migración por dominio + grep final limitado a seeds/tests. | Abierto. |
| medio | Roadmap desactualizado pierde valor. | Actualizarlo como parte obligatoria del Definition of Done. | Abierto. |
| medio | Online-first puede confundir con mala conexión. | Estados visibles de sync, outbox auditable y retries claros. | Abierto. |
| crítico | Piloto con varios usuarios puede generar confianza falsa si Pull/Push no está claramente en verde antes de operar. | Tratar Sync Activity como preflight de piloto: upload queue sin failed/pending inesperados, download coverage activo y smoke con dos usuarios antes de entregar a Iván/Carlos. | Mitigación en progreso: operational snapshots implementado y migración remota aplicada; falta backfill/smoke multiusuario. |
| crítico | Datos operativos remotos podían fallar al aplicarse por FKs locales faltantes o items duplicados y el cursor avanzaba igual. | Cursor solo avanza al aplicar/saltar con seguridad; pull usa lookback de 14 días; Projects/Packing tienen apply tolerante e idempotente. | Mitigado en código el 2026-05-06; falta smoke con la app actualizada y otro usuario. |
| crítico | Instalaciones nuevas/parciales podían fallar antes de cargar renderer si una migración runtime sembraba datos contra un workspace local aún inexistente. | Crear ventana de startup antes de DB init, registrar cada paso de arranque y hacer el bootstrap del project wizard tolerante a FKs faltantes. | Mitigado en código el 2026-05-06; falta revalidar en la Mac de Carlos con el nuevo DMG. |
| crítico | Team mezclaba usuarios locales/demo con memberships remotas, causando updates contra Supabase con IDs no UUID y usuarios Auth existentes sin workspace visible. | Members remoto cuando Supabase está activo; `send-invite` concede membership a usuarios Auth existentes; perfiles remotos incluyen email y policy de lectura por workspace. | Mitigado el 2026-05-06; falta smoke invite/role/status desde app actualizada. |
| medio | Bootstrap remoto creaba sólo Admin, dejando sin opciones operativas el selector de roles al usar Supabase como fuente de verdad. | Migración idempotente siembra roles operativos por workspace y sus role_permissions base. | Mitigado el 2026-05-06. |
| medio | Modelar `AI Agent` como usuario Auth real en todos los workspaces puede contaminar membresías humanas, emails e invitaciones, o requerir credenciales de servicio innecesarias. | Mantener por ahora actor local compatible `user-ops` renombrado; decidir entre tabla `system_actors` remota o service account Auth controlado antes de hacerlo visible en Members remoto. | Abierto como decisión de arquitectura. |
| crítico | Datos operativos existentes antes del nuevo sync podrían no aparecer en otro usuario hasta que se editen localmente. | Crear backfill idempotente para `project`, `packing_slip`, `incident` y `rma_case`, o re-enqueue controlado desde Sync Activity. | Mitigado en código; ejecutado parcialmente por usuario, falta smoke multiusuario con build actualizado. |
| medio | Fallback local-dev podría ocultar errores de Supabase si se usa en prod. | Mostrar estado local fallback y requerir env Supabase para builds release en hardening. | Abierto. |
| bajo | Edge Functions pueden quedar desactualizadas frente al código local si se redeployan manualmente desde Dashboard. | Documentar evidencia en roadmap y migrar a Supabase CLI antes de más functions. | Abierto. |
| medio | Gateway JWT verification de Supabase puede rechazar tokens `ES256` antes de ejecutar functions. | Desactivar `Verify JWT` en functions que validan bearer contra `/auth/v1/user`; registrar `supabase/config.toml`. | Mitigado en dev. |
| medio | Activar Supabase sync antes de aplicar la migración `sync_outbox` marcaría filas como failed/retry. | Mantener `VITE_SUPABASE_SYNC_ENABLED=false` hasta correr la migración y validar una fila real. | Abierto. |
| medio | Workspace remoto existe en Supabase pero no en SQLite local, bloqueando writes workspace-scoped por foreign key. | Cachear memberships/workspaces remotos vía IPC al refrescar `WorkspaceProvider`. | Mitigado y validado en SQLite local. |
| medio | Métricas y tabla de assets pueden mostrar scopes diferentes durante la migración multi-workspace. | Pasar `workspaceId` también a summary/overview y evitar fallback visual a `workspace-metadata` en sesión Supabase. | Mitigado en Assets. |
| medio | CSV import inicial depende de catálogos existentes y aún no crea categorías/ubicaciones faltantes. | MVP importa contra categorías/ubicaciones conocidas; Slice 3 debe cubrir plantillas, preview avanzado y mapeo de catálogos por workspace. | Abierto como deuda UX/data. |
| bajo | Exports reales pueden traer headers localizados, acentos, columnas duplicadas o ubicaciones de almacén que no existen como catálogo. | Normalizar headers con acentos/puntuación, soportar aliases Rentman en español y guardar ubicación/carpeta fuente en notas cuando no hay catálogo local. | Mitigado para CSV probado; mantener abierto para preview/import wizard. |
| medio | Import CSV sin preview escribe inmediatamente y dificulta anticipar duplicados, merges y warnings. | Agregar preview antes de import con códigos únicos, duplicados mergeados, códigos existentes, stock total y warnings. | Mitigado en MVP. |

## Incompletos / deuda técnica

- El schema remoto foundation, las Edge Functions y el flujo autenticado login -> create workspace ya fueron validados contra Supabase dev.
- Guards de sesión/workspace ya existen, pero falta endurecer comportamiento prod sin fallback.
- Validación workspace-scoped ya existe en main para Assets, Packing, Incidents, Projects, RMA read/mutations, Catalog IPC, Finance, Currency y Quotes; falta rediseñar Agents porque todavía arrastra `DEFAULT_WORKSPACE_ID`.
- Aún no se ha iniciado reemplazo de `DEFAULT_WORKSPACE_ID`.
- El worker ya escribe remoto en `public.sync_outbox` y, para filas `asset_event`, ahora proyecta snapshots en `public.assets`, `public.asset_current_state` y `public.asset_events`.
- El worker ahora también proyecta snapshots operativos en `public.operational_snapshots` para Projects, Packing Slips, Incidents y RMAs. La migración `20260505130000_operational_snapshots.sql` ya fue aplicada por el usuario; el backfill idempotente ya existe en Sync Activity. El pull/apply fue endurecido el 2026-05-06 para no avanzar cursor con errores, recuperar cursores adelantados y tolerar FKs opcionales faltantes. Falta smoke con dos usuarios usando build actualizado.
- Packaging hardening: la app ahora descarta bounds de ventana fuera de pantalla y muestra/focus la ventana aunque `ready-to-show` no dispare. Build arm64 interna ya fue generada; falta probar específicamente en la MacBook Air M4 de Carlos.
- Startup hardening: la ventana `Starting bukowskiOS` carga antes de la base local y muestra logo/barra de carga. La migración runtime del project wizard ya no bloquea si el workspace demo no existe localmente o si hay referencias opcionales huérfanas en packing slips. Falta confirmar en máquina externa.
- Team/Members hardening: Carlos fue activado como Admin remoto en `Metadata Cine2`. Queda pendiente empaquetar o correr app actualizada para validar que Invite, Suspend/Reactivate y Role change operan con UUIDs remotos y no con usuarios locales.
- Roles remotos: `Metadata Cine2` ya tiene Admin, Crew, Supervisor, Finance Viewer y Maintenance. `admin-workspace-bootstrap` fue actualizado para que futuros workspaces nazcan con esos roles y permisos base.
- Onboarding UX: login/first-login ya no muestra sidebar/subnav y el flujo de magic link para usuarios existentes puede llevar a crear password. Falta smoke real con un usuario nuevo/invitado: magic link -> password -> workspace picker -> workspace visible.
- AI Agent: el actor local `user-ops` ya se presenta como `AI Agent`. Falta definir representación remota segura si debe aparecer en Team/Members para todos los workspaces; recomendación actual: tabla/relación de `system_actors` por workspace en vez de Auth user humano.
- OAuth Google/GitHub: el código del renderer ya tiene botones y deep link base; falta activar providers en Supabase con credenciales OAuth reales y validar callback `bukowskios://auth/callback` en build instalada.
- Icono desktop: `apps/desktop/build/icon.icns` fue regenerado desde la nueva base `bukowskiOS-desktop-logo.png` y el DMG/ZIP arm64 ya incluyen ese `icon.icns`; falta validar visualmente en Finder/Dock en una instalación limpia.
- Deuda de UX Settings: Sync Activity ya es más consistente, pero Settings sigue teniendo demasiada información técnica visible. Requiere un slice de simplificación: overview simple, secciones avanzadas colapsadas y mensajes orientados a acciones.
- MFA TOTP está como pantalla placeholder; falta wiring real Supabase MFA.
- El transport Supabase está opt-in; `Metadata Cine2` confirmó 675 filas remotas en `public.sync_outbox`.
- La migración `20260416003000_asset_sync_snapshots.sql` ya fue aplicada y validada con una asignación real; el backfill histórico dejó remotas `public.assets`, `public.asset_current_state` y `public.asset_events` en paridad con SQLite para `Metadata Cine2`.
- Falta validar visualmente en app que el cambio de workspace aísla assets creados en cada workspace.
- Deuda técnica: los catálogos ya filtran por workspace en los reads/IPC revisados, pero los catálogos base por workspace todavía no tienen flujo formal de clonado/plantillas; Slice IC-6/Slice 3 debe cubrir creación guiada y bootstrap más claro.
- Import CSV de assets ya existe como MVP probado con CSV real Rentman y ahora muestra preview/resumen antes de escribir; falta agregar template descargable, errores por fila más detallados y creación guiada de categorías/ubicaciones faltantes.
- IC-3 agrega acciones single-asset desde la bandeja para Report issue / Create RMA; multi-incident y multi-RMA quedan explícitamente diferidos para no mezclar operaciones masivas con flujos que necesitan contexto de daño.
- Documento de handoff creado en `docs/handoff/2026-04-15-auth-workspaces-assets-handoff.md`.

## Próximo paso recomendado

Nuevo foco recomendado: **Pilot Readiness Hardening** antes de seguir con Finance/Agents o Notifications.

Objetivo: que Iván y Carlos puedan usar la app con login real, workspace correcto, permisos mínimos, sync entendible y flujos operativos base sin workarounds.

Orden sugerido:

1. Smoke de onboarding con usuario nuevo o invitado: invite -> email/magic link -> create password -> workspace picker -> workspace visible.
2. Activar y probar OAuth Google/GitHub en Supabase Dashboard con redirect `bukowskios://auth/callback`.
3. Decidir modelo remoto del `AI Agent`: `system_actors` recomendado para auditoría sin emails; service account Auth sólo si necesitamos que RLS lo trate como usuario real.
4. Empaquetar de nuevo con icono actualizado, auth UX y window hardening.
5. Probar instalación en otra Mac (idealmente Carlos) y confirmar login/workspace/sync.
6. Abrir Sync Activity en la build nueva, dejar que el pull corra o forzar refresh, y confirmar que `projects`/`packing_slips` dejan de mostrar errores de cursor/FK.
7. Smoke manual con dos usuarios/workspace: login, switch workspace, crear proyecto, crear packing slip, incidente, RMA y retorno.
8. Rediseñar Agents para workspace activo, eliminando `DEFAULT_WORKSPACE_ID` del runtime de agentes.
9. Retomar Notifications/Todos/Reminders cuando el piloto no dependa de estados manuales de sync.
