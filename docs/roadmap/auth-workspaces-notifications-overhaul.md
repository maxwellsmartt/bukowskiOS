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
| 0 — Foundation Supabase + Seguridad | In progress | 2026-04-15 |  | Codex | Dependencias instaladas; roadmap, paquete Supabase, Keychain IPC, deep links, migración y Edge Function stubs creados. Typecheck/build/tests pasan. |
| 1 — Auth + Workspace Vertical MVP | In progress | 2026-04-15 |  | Codex | Providers de sesión/workspace, rutas auth, guardas, switcher y create workspace remoto vía Edge Function wiring creados. Typecheck/build/tests pasan: 26 archivos, 96 tests. |
| 2 — Roles, Permissions e Invites | Todo |  |  | Codex | Pendiente. |
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
- Todo — Validar migración contra un proyecto Supabase real.
- Todo — Desplegar Edge Functions en entorno dev.

### Slice 1 — Auth + Workspace Vertical MVP

- Done — Crear `SessionProvider` con Supabase PKCE y fallback local-dev seguro.
- Done — Rehidratar sesión Supabase desde Keychain al arrancar.
- Done — Crear `WorkspaceProvider` con active workspace persistido y fallback `workspace-metadata`.
- Done — Crear pantallas login/recovery/MFA placeholder/workspace picker/create.
- Done — Agregar guards sesión/workspace sin romper el modo local actual.
- Done — Implementar workspace switch básico en top bar.
- Done — Conectar `WorkspaceCreateScreen` a la Edge Function `admin-workspace-bootstrap` cuando Supabase está configurado.
- Doing — Portar estética/login desde `checkbox_app` con más fidelidad visual.
- Todo — Migrar flujo assets a workspace activo + outbox Supabase.
- Todo — Conectar MFA TOTP real con Supabase MFA.

### Slice 2 — Roles, Permissions e Invites

- Todo — Roles de sistema inmutables y clonables.
- Todo — Refactor Settings en Members/Roles/Crew/Invitations.
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

## Decisiones tomadas

- Supabase es source of truth; SQLite queda como cache local + outbox.
- Electron nunca contiene `service_role`.
- Edge Functions/RPC cubren operaciones admin como invites.
- Se conserva `DEFAULT_WORKSPACE_ID` solo en seeds/test fixtures durante la migración.
- Magic link queda dentro de auth v1.

## Alternativas descartadas

- Service role en Electron: descartado por riesgo crítico de extracción de secretos.
- Big-bang total sin vertical MVP: descartado por riesgo alto de bloquear testing temprano.
- Roles de sistema editables: descartado por riesgo operacional; se permiten clones.

## Riesgos

| Impacto | Riesgo | Mitigación | Estado |
| --- | --- | --- | --- |
| crítico | Exponer service role en Electron compromete toda la base. | Solo anon/JWT en app; admin por Edge Functions/RPC. | Abierto, mitigación aplicada en diseño. |
| crítico | Confiar en `workspaceId` del renderer permite acceso cruzado. | Validar sesión, membership y permisos en main/RLS. | Abierto. |
| medio | `DEFAULT_WORKSPACE_ID` está distribuido y puede romper flujos. | Migración por dominio + grep final limitado a seeds/tests. | Abierto. |
| medio | Roadmap desactualizado pierde valor. | Actualizarlo como parte obligatoria del Definition of Done. | Abierto. |
| medio | Online-first puede confundir con mala conexión. | Estados visibles de sync, outbox auditable y retries claros. | Abierto. |
| medio | Fallback local-dev podría ocultar errores de Supabase si se usa en prod. | Mostrar estado local fallback y requerir env Supabase para builds release en hardening. | Abierto. |

## Incompletos / deuda técnica

- Aún no existe schema remoto desplegado ni validado contra Supabase real.
- Guards de sesión/workspace ya existen, pero falta endurecer comportamiento prod sin fallback.
- Aún no hay validación workspace-scoped aplicada a handlers existentes.
- Aún no se ha iniciado reemplazo de `DEFAULT_WORKSPACE_ID`.
- Aún no se ha implementado sync remoto real; el worker actual sigue haciendo acknowledge local.
- MFA TOTP está como pantalla placeholder; falta wiring real Supabase MFA.
- Workspace Create ya llama Edge Function cuando Supabase está configurado; falta validar contra Supabase dev real.

## Próximo paso recomendado

Validar `admin-workspace-bootstrap` contra Supabase dev real y luego avanzar al vertical MVP de assets por workspace activo con outbox/retry auditable.
