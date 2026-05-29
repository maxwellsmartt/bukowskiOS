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

## Pendiente / seguimiento

- **H-4**: migrar handlers de admin a `safeHandle` cuando se toquen.
- Revisar con Carlos qué permisos tiene el rol "Contable" sobre treasury vs.
  admin (ya sembrado con read/review/export).
- Auditoría completa post-implementación (solicitada por el usuario) — ver
  checklist al final de la iteración.
