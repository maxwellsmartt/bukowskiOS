# Handoff — Auth, Workspaces, Assets CSV & Sync

Fecha: 2026-04-15  
Branch: `codex/project-creation-wizard-v1`  
Roadmap vivo: `docs/roadmap/auth-workspaces-notifications-overhaul.md`

## Estado Ejecutivo

El trabajo está en Slice 1: **Auth + Workspace Vertical MVP**.

Ya funciona el flujo real Supabase de login y creación de workspace. El workspace remoto `Metadata Cine2` quedó cacheado en SQLite local y el dominio de Assets ya respeta el `workspaceId` activo para lista, métricas, create/edit/archive, packing slip y assign/move.

También se implementó import CSV en Assets y se probó contra el CSV real `Exportación_Equipos_20211015 (1).csv`. El import ahora soporta headers en español/Rentman, cantidades en cero, duplicados internos por serial, reintentos idempotentes y preserva metadata fuente en notas.

## Commits Relevantes Recientes

- `f94e516 fix: merge duplicate rows in asset csv import`
- `fa198e5 fix: harden duplicate csv import detection`
- `330d0d9 fix: skip duplicate asset csv rows`
- `b149a80 fix: allow zero quantity asset imports`
- `7a16751 fix: support rentman asset csv imports`
- `2885f1a feat: add asset csv import`
- `4dc839b fix: scope asset metrics by workspace`
- `2340dfd fix: align local workspace cache schema`
- `31a1d18 fix: cache remote workspaces locally`
- `28f44cf feat: add supabase outbox transport`
- `d0f957f feat: scope assets to active workspace`

## Infra / Supabase

Proyecto Supabase dev usado:

- URL: `https://jmxkejpdklrrzhvzjlqm.supabase.co`
- Auth email/password activo.
- Google/GitHub auth todavía inactivos.
- Edge Functions desplegadas:
  - `admin-workspace-bootstrap`
  - `send-invite`
- Las functions que validan bearer internamente deben tener `Verify JWT` desactivado en Supabase porque el gateway rechazaba tokens `ES256`.
- `apps/desktop/.env.local` existe localmente y no debe commitearse.

## Estado Local Confirmado

SQLite local:

`/Users/ernestooffice2/Library/Application Support/@bukowski/desktop/bukowski-foundation.sqlite`

Backup antes de reconciliar CSV:

`/Users/ernestooffice2/Library/Application Support/@bukowski/desktop/bukowski-foundation.pre-csv-reconcile-20260415.sqlite`

Workspaces locales:

- `workspace-metadata` — `Metadata Cine`
- `6e52fcda-6dae-40af-9a80-0cf22035844c` — `Metadata Cine2`

Datos de assets al cierre:

- `Metadata Cine2`: 629 assets, stock total 1727, stock disponible 1727.
- `Metadata Cine`: 789 assets, stock total 3243, stock disponible 3241.
- CSV real tenía 785 filas pero 629 códigos únicos.
- Se reconciliaron 45 assets con seriales/filas fuente.
- Se ajustaron 2 assets por cantidad consolidada.

Outbox al cierre:

- Workspace `Metadata Cine2`: `sent = 449`, `pending = 225`.
- El worker estaba drenando filas en batches sin fallos recientes.

## CSV Import: Qué Hace Ahora

Archivo probado:

`/Users/ernestooffice2/Desktop/Exportación_Equipos_20211015 (1).csv`

Soporta headers como:

- `Nombre (en la base de datos)`
- `Nombre (en la base de datos) 2`
- `Código`
- `Cantidad actual`
- `Códigos QR`
- `Ubicado en almacén`
- `Número de Serie (Número de serie)`
- `Estructura de la carpeta (Carpeta)`
- `Tipo de articulo (Carpeta)`
- `Tipo (posición/case/set)`
- `Nota externa`

Reglas aplicadas:

- Un asset por `Código`.
- `Cantidad actual` se guarda como `totalQuantity`.
- `Cantidad actual = 0` es válido.
- Filas duplicadas por código se mergean.
- Seriales múltiples se guardan en notes como `Source serials`.
- Filas fuente se guardan en notes como `Merged CSV rows`.
- Ubicación de almacén no bloquea si no existe como catálogo; se guarda en notes.
- Reintentos saltan códigos ya existentes.

## Riesgos / Deuda Técnica Abierta

Impacto crítico:

- El main todavía debe validar sesión + membership + permisos en handlers workspace-scoped. Ahora el renderer envía `workspaceId`; eso no es suficiente como control de seguridad final.

Impacto medio:

- `sync_outbox` está transportando eventos, pero falta decidir si el remoto debe recibir snapshots/upserts completos de `assets`, `asset_current_state`, etc. o si se reconstruirá desde eventos.
- El import CSV todavía no tiene preview antes de escribir.
- No hay wizard de mapeo de columnas ni creación guiada de categorías/locations faltantes.
- Catálogos base aún no están formalmente workspace-scoped/clonados.
- `DEFAULT_WORKSPACE_ID` sigue existiendo en varios dominios fuera de Assets.
- MFA TOTP sigue como placeholder.

Impacto bajo:

- `bukowskiAuth:setStoredTokens` puede emitir error genérico desde Keychain/Electron; el renderer ya no lo deja como unhandled promise, pero falta investigar causa raíz si persiste.
- Vite/Electron dev muestra `render-process-gone: killed` cuando reinicia el main por HMR; hasta ahora parece ruido de dev restart, no crash funcional.

## Verificaciones Corridas

En la última ronda:

- `corepack pnpm --filter @bukowski/desktop typecheck`
- `corepack pnpm --filter @bukowski/desktop test -- asset-mutation-service.test.ts`
  - Vitest terminó corriendo 26 archivos / 99 tests.
- `corepack pnpm --filter @bukowski/desktop build`

Todas pasaron.

## Qué Sigue Recomendado

### 1. Esperar o verificar que el outbox termine de drenar

Confirmar local:

```sh
sqlite3 '/Users/ernestooffice2/Library/Application Support/@bukowski/desktop/bukowski-foundation.sqlite' "SELECT status, COUNT(*) FROM sync_outbox WHERE workspace_id='6e52fcda-6dae-40af-9a80-0cf22035844c' GROUP BY status;"
```

Luego validar remoto en Supabase que `public.sync_outbox` recibió filas recientes del workspace.

### 2. Convertir CSV Import en flujo producto

Implementar preview antes de importar:

- Total filas.
- Códigos únicos.
- Duplicados internos mergeados.
- Códigos existentes que se saltarán.
- Stock total resultante.
- Warnings por categorías/ubicaciones no encontradas.
- Botón `Import`.

### 3. Endurecer sync de Assets

Decidir contrato remoto:

- Opción A: outbox manda eventos y Supabase reconstruye.
- Opción B: transport hace upsert de snapshot a tablas remotas (`assets`, `asset_current_state`, etc.).

Recomendación: para MVP vertical, usar snapshot/upsert para que sea más fácil debugear y verificar.

### 4. Workspace-scoped IPC validation

Crear middleware/utility en main:

- Verificar sesión Supabase actual.
- Verificar membership activa para `workspaceId`.
- Preparar `requiresPermission` para Slice 2.

### 5. Catálogos por workspace

Antes de avanzar fuerte en Roles/Permissions, resolver si categories/locations serán:

- Globales con filtro lógico.
- Clonadas por workspace.
- Compartidas con override por workspace.

Recomendación MVP: clonar categorías/locations base al crear workspace y permitir import sin bloquear por catálogos incompletos.

## Prompt Sugerido Para Continuar En Otro Thread

Estoy en el repo `/Users/ernestooffice2/Dev/bukowskiOS`, branch `codex/project-creation-wizard-v1`. Lee primero `docs/handoff/2026-04-15-auth-workspaces-assets-handoff.md` y `docs/roadmap/auth-workspaces-notifications-overhaul.md`. Quiero continuar el Slice 1 del overhaul Auth/Workspaces/Assets. Ya hay login Supabase, workspace remoto, cache local, Assets workspace-scoped, import CSV Rentman y sync_outbox. Lo próximo recomendado es validar que `sync_outbox` termine de drenar y luego implementar preview del CSV import o hardening de sync remoto de assets. Mantén actualizado el roadmap vivo y no avances a Slice 2 hasta cerrar el vertical MVP de Assets/Sync.
