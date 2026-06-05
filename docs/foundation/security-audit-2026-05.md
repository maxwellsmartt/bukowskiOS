# Auditoría de Seguridad — Mayo 2026 (PILAR T · Iteración 3, I4)

## Objetivo

Auditar bukowskiOS con foco en **seguridad, control de datos, anti-leaking y
anti-exploiting**, dado que el app maneja datos fiscales/financieros sensibles
(facturas, cuentas bancarias, retenciones, honorarios, cédulas de crew). Esta
ronda **corrige los hallazgos concretos** y documenta el resto. El track de
diseño/estilos/tablas/sync queda en `treasury-design-backlog.md`.

Convención de severidad:
- **HIGH** — fuga de datos cross-workspace, ejecución no confiable, o exposición
  de secretos.
- **MED** — endurecimiento recomendado; sin explotación directa conocida.
- **LOW** — higiene / consistencia.

Estado: `fixed` (corregido esta ronda) · `deferred` (documentado, no bloquea) ·
`accepted` (riesgo aceptado por diseño).

---

## Resumen ejecutivo

El app ya parte de una base endurecida: Electron con `contextIsolation`,
`sandbox`, `nodeIntegration: false`, CSP estricta y `setWindowOpenHandler`
denegando ventanas nuevas (`securityConfig.ts`). El acceso a datos pasa por un
guard de workspace (`workspaceAccessGuard.ts`) y las tablas Supabase usan RLS
con `has_permission(workspace_id, ...)` — **ninguna política usa `USING (true)`**.

Esta ronda cerró tres huecos concretos (un guard de lectura faltante, redacción
de logs incompleta, y documentación del fail-open de lecturas), y dejó
registrado el endurecimiento pendiente (unificación de handlers IPC).

### Actualización 2026-06-05 - estado post remediación S0-S6.1

Desde la auditoría profunda ya se cerraron los frentes que bloqueaban trabajar
con datos sensibles en piloto controlado: permisos/RLS, tokens fuera del
renderer, writes sensibles movidos a IPC main, approvals de AI tools, redacción
de exports/support/outbox, límites de XLSX, privacidad de archivos locales y
SQLCipher con smoke real en Electron.

Estado actual: **apto para continuar smoke interno/piloto controlado con mucha
menos exposición local**, siempre distinguiendo internal alpha de release final.
El riesgo más importante que queda ya no es una fuga directa en app/data layer,
sino **integridad de distribución**: signing/notarization reales, disciplina de
release y validación de build en máquina externa antes de entregar a usuarios no
técnicos.

Fixes cerrados desde el 2026-06-03:

| Finding / frente | Estado | Evidencia |
|------------------|--------|-----------|
| S4 - exports/support bundle/outbox redaction | `fixed` | `syncOutboxWorkerService.ts`, `logger.ts`, `supportDiagnosticsService.ts`, `security-regression.test.ts` |
| S5 - XLSX import hardening | `fixed` | `xlsxSafety.ts`, `bankStatementParsers.ts`, `documentExtractionService.ts`, tests de parsers/extraction |
| S6 - data-at-rest incremental | `fixed` | `storagePrivacy.ts`, permisos `0600/0700`, writes privados en backups/documentos/adjuntos |
| S6 - SQLCipher + key segura + backups cifrados | `fixed` | `databaseEncryption.ts`, `databaseKeyStore.ts`, `localDatabase.ts`, diagnostics `databaseEncrypted` |
| S6.1 - runtime Electron SQLCipher smoke | `fixed` | commit `aae263f`, `e2e/smoke/database-encryption.spec.ts`, fail-closed sin fallback plaintext |

Riesgos abiertos priorizados:

| Prioridad | Riesgo | Impacto real | Fix rápido | Fix definitivo |
|-----------|--------|--------------|------------|----------------|
| P0 crítico | Release integrity/signing/notarization no validado end-to-end con credenciales reales | Un build interno puede confundirse con release; Gatekeeper/supply-chain quedan débiles | Mantener internal alpha explícito, no distribuir como final, correr `package:mac` + `verify:mac-build` | Release lane con Developer ID, notarization, stapling, evidencia `spctl` y checklist firmado |
| P0 medio/alto | Smoke externo en Mac limpia pendiente | Bugs de permisos, Keychain, SQLCipher o Gatekeeper pueden aparecer fuera de la máquina dev | Probar DMG/ZIP en otra Mac con user limpio y capturar evidencia | Matriz de release smoke por arquitectura y versión, documentada |
| P1 medio | Permisos offline cacheados amplios por diseño | Revocaciones remotas pueden tardar en reflejarse localmente | Mostrar estado offline/cache y restringir acciones sensibles offline | Broker de permisos por capacidad + TTL menor para acciones admin/write |
| P1 medio | Lecturas Supabase aún existen en renderer | Si renderer se compromete, aumenta superficie aunque RLS siga protegiendo | Priorizar dominios sensibles para mover reads a IPC main | Data access broker por dominio/capacidad |
| P1 medio | Runs legacy sin `approval_tool_payloads` | Compatibilidad puede permitir aprobaciones antiguas menos auditables | Bloquear aprobación de runs legacy en UI/admin | Migración/purge de runs legacy con recibos |

Quick wins recomendados antes de seguir features:

1. Ejecutar y documentar smoke de internal alpha en Mac limpia: arranque,
   login, Settings diagnostics, backup, export con confirmación y quit/reopen.
2. Añadir banner/copy visible en build internal alpha: "Internal alpha - not
   notarized release" si todavía no hay Developer ID/notarization.
3. Agregar checklist de release evidence con fecha, commit, `codesign`,
   `spctl`, notarization/staple y resultado del smoke externo.
4. Revisar que support bundle/log export no incluya rutas absolutas ni tokens
   en una corrida real posterior a los fixes.
5. Documentar política operativa de pérdida de Keychain/DB: qué mensaje ve el
   usuario, qué backup se usa y cuándo escalar manualmente.

Orden recomendado para continuar desde oficina:

1. **Release integrity/signing/notarization evidence**: cerrar la diferencia
   entre internal alpha y release final con pruebas reproducibles.
2. **Smoke externo en Mac limpia**: validar SQLCipher/Keychain/Gatekeeper fuera
   del entorno de desarrollo.
3. **Offline permission narrowing**: bajar riesgo de revocaciones tardías y UI
   permisiva sin conexión.
4. **Export/support smoke real**: validar redacción de logs/support bundles con
   artefactos generados por la app, sin imprimir secretos.
5. **AI approvals legacy cleanup**: bloquear/migrar runs viejos sin payload
   firmado si existen.

### Actualización 2026-06-03 - estado post auditoría profunda

La auditoría profunda del 2026-06-02 cambió el estado de release: **todavía no
hay visto bueno para alojar información confidencial sin restricciones**. Sí se
han cerrado los riesgos críticos de takeover, permisos Supabase, tokens en
renderer y navegación trusted renderer. El estado actual permite seguir con
smoke interno y datos controlados, pero antes de entregar a Carlos con datos
sensibles conviene cerrar los slices restantes de exports/support bundle,
dependencia `xlsx` y data-at-rest. Estos tres frentes quedaron cerrados entre
el 2026-06-04 y el 2026-06-05; ver actualización 2026-06-05 arriba.

Fixes cerrados desde la auditoría profunda:

| Finding | Estado | Commits / evidencia |
|---------|--------|---------------------|
| B1 / C1 / C2 / C3 - workspace takeover, rol cross-workspace, Storage y permisos finance | `fixed` | `abcc669` + migración `20260602130000_security_workspace_role_and_documents.sql` |
| C4 / C5 - refresh tokens expuestos, trusted renderer amplio y navegación no bloqueada | `fixed` | `8bb3424` |
| PGRST201 por relaciones duplicadas de roles | `fixed` | `376bdb7` |
| C4.2a - Edge Functions sensibles llamadas desde renderer | `fixed` | `168ab79` |
| C4.2b - uploads Storage confiados desde renderer | `fixed` | `d2874fd` |
| C4.2c - mutaciones admin de workspace desde renderer | `fixed` | `8b26185` |
| C4.2d - `user_profiles.upsert` desde renderer | `fixed` | `b3baf44` |
| C6/C7/C8 - AI tools, allowlists y approvals exactos | `fixed` | S3: `assistantGatewayService.ts`, `agentToolRegistry.ts`, tests `assistant-gateway-service.test.ts` + `agent-tool-registry.test.ts` |

Riesgos abiertos más importantes:

| Riesgo | Severidad | Significado práctico | Consecuencia si no se corrige |
|--------|-----------|----------------------|-------------------------------|
| B2 - SQLite, backups y documentos locales sin cifrado app-level | `fixed` | Cerrado con permisos privados, SQLCipher, key segura, backups cifrados y smoke Electron | Riesgo residual: pérdida de Keychain/recovery UX debe documentarse |
| C11/M3 - exports/support bundle/outbox payload con demasiados datos | `fixed` | Support/logs/outbox salen saneados y exports sensibles piden confirmación explícita | Riesgo residual: falta smoke real de artefactos exportados post-fix |
| C12 - release no notarizado puede confundirse con build final | `crítico` para distribución | Un build interno puede parecer listo para usuarios externos | Riesgo de confianza, Gatekeeper y supply chain |
| C13 - parsing `xlsx` vulnerable/no aislado | `fixed` | Se añadieron límites de tamaño, hojas, filas y columnas en parser compartido | Riesgo residual: phase 2 puede aislar/cancelar parsing si aparecen archivos extremos |
| M1 - permisos offline cacheados demasiado amplios | `medio` | El usuario desconectado puede ver una UI más permisiva que su estado remoto actual | Revocaciones tardías y confusión operativa |

Próximo orden recomendado actualizado: ver la sección **Actualización
2026-06-05** arriba. El primer frente pendiente ahora es **release
integrity/signing/notarization evidence**, seguido por smoke externo en Mac
limpia y narrowing de permisos offline.

### Actualización 2026-06-05 - auditoría Finance/Roles post hardening

Se revisó el último batch de cambios de Finance/Roles (`fix: harden finance
access and workspace cache`) con foco en fugas indirectas. Resultado: el
hardening va en buena dirección, pero **todavía no hay visto bueno final para
datos financieros confidenciales**. Los guards directos de Finance/Treasury en
IPC y el fallback offline de `workspaceAccessGuard` están sustancialmente mejor,
pero quedan tres rutas que pueden exponer datos económicos fuera de la
superficie Finance.

Hallazgos nuevos:

| ID | Severidad | Estado | Significado práctico | Consecuencia si no se corrige |
|----|-----------|--------|----------------------|-------------------------------|
| F-R1 | `crítico` | `open` | Los tools del chat/agentes tienen allowlist por agente, pero no verifican permisos del usuario antes de leer Finance/Treasury. | Un usuario sin Finance podría pedir al chat movimientos bancarios, P&L, DGII ledger o health financiero y recibir datos aunque la UI esconda Finance. |
| F-R2 | `alto` | `open` | Varias mutaciones de Projects devuelven listas/detalles con defaults financieros después de crear/editar/archivar. | Un usuario con `projects.manage` pero sin Finance puede recibir `exposure`, budget u otros campos económicos en el payload IPC post-mutación. |
| F-R3 | `medio` | `open` | `getProjectDetail(..., { includeFinancials: false })` aún devuelve `replacementValue` y `costEstimate`. | Si la regla es "sin Finance no ve datos económicos", Projects/Assets/Incidents siguen filtrando valores monetarios. |

Evidencia técnica:

- `apps/desktop/electron/main/services/ai/agentToolRegistry.ts`: tools como
  `get_financial_exposure_summary`, `get_budget_vs_actual`,
  `get_financial_health`, `get_treasury_overview`, `list_bank_movements`,
  `get_deductible_ledger`, `get_dgii_report` y `get_project_pnl` llaman directo
  a read services internos.
- `apps/desktop/electron/main/services/ai/assistantGatewayService.ts`: el
  gateway filtra por `allowed_tools_json` del agente, pero ese allowlist no es
  equivalente a permisos del usuario actual.
- `apps/desktop/electron/main/ipc/registerFoundationIpc.ts`: las lecturas
  directas de Projects ya usan `{ includeFinancials }`, pero los returns
  post-mutación (`projects.create`, `createBlueprint`, `update`, `archive`,
  `unarchive`, `delete`, `createUnit`, `updateUnit`, `deleteUnit`,
  `assignCrewToUnit`, `unassignCrewFromUnit`) vuelven a llamar
  `foundationReads.getProjects(...)` o `foundationReads.getProjectDetail(...)`
  sin pasar visibilidad financiera.
- `apps/desktop/electron/main/services/data/projectReadService.ts`:
  `includeFinancials=false` oculta `exposure`/`budget`, pero no
  `replacementValue` ni `costEstimate`.

Orden de fixes recomendado:

1. **F-R1 primero**: convertir el tool registry en una frontera de seguridad.
   Cada tool financiero debe declarar `requiredPermission`; `execute()` debe
   negar ejecución si el usuario actual no tiene ese permiso. Para esto el
   contexto del gateway debe incluir identidad/permisos confiables resueltos en
   main, no datos enviados desde renderer.
2. **F-R2 segundo**: crear helpers internos para devolver Project list/detail
   sanitizados después de cualquier mutación. No debe quedar ningún call-site de
   `getProjects/getProjectDetail` expuesto a renderer sin decisión explícita de
   `includeFinancials`.
3. **F-R3 tercero**: decidir con producto si `replacementValue` y
   `costEstimate` son datos financieros restringidos. Si sí, enmascararlos en
   read service y ocultar columnas en UI para usuarios sin Finance.

Tests sugeridos para cerrar:

- Test unitario de `agentToolRegistry.execute()` que rechace tools
  Finance/Treasury sin `finance.read` / `treasury.transactions.read`.
- Test de gateway que demuestre que un usuario no-finance no puede recibir
  payload financiero aunque el Finance Agent tenga el tool en `allowed_tools_json`.
- Test estático o unitario que cubra todos los returns post-mutación de Projects
  y falle si aparece `foundationReads.getProjects(...)` o
  `foundationReads.getProjectDetail(...)` sin visibilidad financiera explícita.
- Test de `projectReadService` para `includeFinancials=false` sobre
  `replacementValue` y `costEstimate`, según la decisión de producto.

---

## Hallazgos

### H-1 · `fixed` · MED — Lectura/borrado de documentos de crew sin guard de workspace
**Evidencia:** `apps/desktop/electron/main/ipc/registerFoundationIpc.ts`
(`catalog.openCrewDocument`, `catalog.deleteCrewDocument`).

Los handlers resolvían un `crew_documents.id` y abrían/borraban el archivo sin
verificar que el llamador tuviera acceso al workspace dueño del documento. Los
documentos de crew incluyen cédulas y datos personales → fuga cross-workspace
potencial si se conociera/forzara un `fileId`.

**Fix:** se añadió `assertCrewDocumentAccess(fileId, action, accessLevel)` al
guard (resuelve `crew_documents → crew_members → workspace_id`) y se enforza
`read` en open y `write` en delete, igual que los guards de archivos de assets
e incidentes. Test nuevo en `workspace-access-guard.test.ts`.

### H-2 · `fixed` · MED — Logs no redactaban JWT / tokens de Supabase
**Evidencia:** `apps/desktop/electron/main/services/logger.ts:29` (antes solo
redactaba `sk-*`, `Bearer`, `ghp_*` y base64 largo).

Los access/refresh tokens de Supabase tienen forma JWT (`eyJ...` en tres
segmentos base64url) y no caían siempre en los patrones previos → riesgo de que
un token quedara en claro en `bukowski-YYYY-MM-DD.log` (exportable vía support
bundle).

**Fix:** se agregó el patrón
`\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+ → [redacted-jwt]`.
Test en `logger.test.ts` verifica que un JWT de ejemplo no aparece en el archivo.

### H-3 · `accepted` (documentado) · MED — Fail-open en lecturas ante red caída
**Evidencia:** `workspaceAccessGuard.ts` (catch del fetch, rama
`if (accessLevel === "read") return;`).

Ante un error de red en la verificación remota de permisos, una **lectura** se
permite (tolerancia offline). Inicialmente se evaluó cerrarlo, pero
`assertLocalWorkspaceExists(workspaceId)` corre **antes** del fetch y lanza
"That workspace is not available on this device." para cualquier workspace que
el usuario no tenga localmente. Como un workspace solo existe localmente si el
usuario es miembro, el fail-open queda acotado a **datos del propio usuario** —
no es una fuga cross-workspace. Se añadió comentario explicativo en el código y
un test (`denies reads for unknown workspaces when Supabase is unreachable`) que
fija esta garantía. Las **escrituras** sí fallan cerradas offline.

### H-4 · `fixed` · MED — Handlers IPC de admin sin `safeHandle` unificado
**Resuelto (O0-E1):** todos los `ipcMain.handle` crudos de `registerAppIpc.ts`
(user-admin, documents-root, backup/integrity/sync, retries, exports,
openExternal, writeClipboard) se migraron a `safeHandle`/`safeHandleRead`, que
centralizan `assertTrustedIpcSender` + validación + `sanitizeIpcError`. Ya no
quedan handlers crudos en ese archivo. (Hallazgo original abajo.)

### H-4 (original) · MED — Handlers IPC de admin sin `safeHandle` unificado
**Evidencia:** `registerAppIpc.ts` (`createUser`, `updateUser`, `setUserActive`,
`revokeTelegramLink`, `deleteUser`, y los de documents-root) usan
`ipcMain.handle` crudo en vez de `safeHandle`/`safeHandleReadWithSchema`.

No es un hueco abierto: **todos** llaman `assertTrustedIpcSender(event)` (rechaza
remotos no confiables) y `sanitizeIpcError(...)` (no filtra detalles internos),
y validan input con `schema.parse()` dentro del servicio. La diferencia con
`safeHandle` es que la validación Zod no está en el borde IPC sino en el
servicio. Se difiere la unificación por ser **churn de bajo valor / riesgo de
regresión** sobre handlers ya protegidos; se recomienda migrarlos cuando se
toquen por otra razón.

### H-5 · `accepted` · LOW — Anon key de Supabase embebida en el cliente
**Evidencia:** configuración de Supabase en el bundle del renderer/main.

Es el patrón esperado de Supabase: la `anon key` es pública por diseño y la
seguridad real la da RLS (`has_permission`). No es un secreto. La `service_role`
key **no** está en el cliente. Sin acción.

### H-6 · `accepted` · LOW — Cache de membresía de 5 min en el guard
**Evidencia:** `workspaceAccessGuard.ts` (`membershipCache` + `cacheTtlMs`).

Una revocación de permiso puede tardar hasta el TTL en reflejarse en una sesión
activa. Aceptable para una app de escritorio de equipo pequeño; reduce llamadas
a Supabase. Documentado para visibilidad.

### H-7 · `accepted` · LOW — Fallback de `safeStorage`
**Evidencia:** almacenamiento de tokens.

Cuando el keychain del SO no está disponible, `safeStorage` degrada a un cifrado
más débil. Es el comportamiento estándar de Electron; el riesgo es local a la
máquina (requiere acceso físico/usuario). Sin acción esta ronda.

---

## RLS / Supabase (verificado)

- **0 políticas `USING (true)`** en `supabase/migrations/`.
- 16 migraciones habilitan `ENABLE ROW LEVEL SECURITY`.
- Tablas sensibles confirmadas con RLS por permiso:
  - `invoice_extractions` / `invoice_extraction_projects` →
    `has_permission(workspace_id, 'treasury.transactions.read' | '...classify')`.
  - `bank_transactions` y demás de treasury → `treasury_schema.sql`.
  - `software_licenses` → migraciones de licenses (read/write por permiso).
  - `collaborator_fees` / pagos → `collaborator_payments_sync.sql`.

## Electron hardening (verificado, sin cambios)

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`.
- CSP estricta; `setWindowOpenHandler` → `deny`.
- IPC con `assertTrustedIpcSender` + `sanitizeIpcError` en handlers crudos;
  `safeHandle`/`safeHandleReadWithSchema` (Zod) en la mayoría.
- Apertura de URLs externas vía `assertAllowedExternalUrl`.

---

## Cambios de esta ronda (I4a)

| Commit | Cambio |
|--------|--------|
| `d6069a6` | Redacción de JWT en logs (H-2) + doc/test del fail-open de lecturas (H-3) |
| `a5a3601` | `assertCrewDocumentAccess` en open/delete de documentos de crew (H-1) |
| `abcc669` | Migración Supabase de permisos/RLS/documentos y hardening de finance/workspace roles |
| `8bb3424` | Tokens Supabase fuera de `getStoredTokens`; trusted renderer exacto y `will-navigate` cerrado |
| `376bdb7` | Embed explícito `roles!workspace_memberships_workspace_role_fk` para evitar PGRST201 |
| `168ab79` | Edge Functions sensibles de workspace movidas detrás de IPC main |
| `d2874fd` | Uploads de avatares/assets de workspace movidos a IPC main |
| `8b26185` | Mutaciones admin de workspace movidas a IPC main |
| `b3baf44` | `user_profiles.upsert` movido a IPC main y cubierto por test de regresión |
| S3 | AI tool catalog filtrado por allowlist de agente, writes sensibles bloqueados aunque el thread sea `unsupervised`, approvals guardan payload exacto con SHA-256 y la ejecución aprobada usa ese payload sin reconsultar al modelo |

## Pendiente / seguimiento

- **B2**: cifrar SQLite/backups/document cache antes de aprobar uso amplio con
  datos confidenciales.
- **C11/M3**: reducir datos expuestos por exports/support bundle/outbox.
- **C13**: endurecer importación XLSX de bancos.
- **C6/C7/C8 seguimiento menor**: runs legacy sin `approval_tool_payloads` conservan fallback de compatibilidad; conviene purgarlos o migrarlos si existieran antes de producción amplia.
- **H-4**: continuar migrando cualquier handler restante a `safeHandle` cuando
  se toque.
- Revisar con Carlos qué permisos tiene el rol "Contable" sobre treasury vs.
  admin (ya sembrado con read/review/export).
- Auditoría completa post-implementación (solicitada por el usuario) — ver
  checklist al final de la iteración.
