# Backlog de diseño y sync — Treasury / Finance (diferido)

## Contexto

Durante PILAR T (Iteración 3) el usuario decidió: **seguridad ahora + doc, y el
track de diseño/estilos/tablas/sync se documenta como backlog** para atacarlo por
fases más adelante. Este documento recoge lo observado en uso real (oficina +
casa) y lo deja priorizado, sin implementar todavía.

No es un plan cerrado: es la lista de deuda de diseño/UX/sync para cuando se abra
una fase dedicada de pulido.

---

## 1. Unificación de estilos

- **Tokens y superficies inconsistentes** entre vistas de finance (Treasury,
  Quotes, Invoices, Payroll, Reports). Falta una pasada que unifique paddings,
  radios, sombras y densidad bajo los tokens de `global.css`.
- **`SurfaceCard`** se usa con variaciones ad-hoc (algunos cards meten su propio
  padding/flex). Definir variantes canónicas (`SurfaceCard`, `SurfaceCard --fill`,
  `SurfaceCard --scroll`) y migrar.
- **Botones / chips / badges**: revisar que estados (danger, muted, success)
  usen el mismo set de clases en todo finance.

## 2. Perfeccionamiento de tablas (`DataTable`)

- **Altura**: hoy conviven tres modos — adaptativo (mide scroll-parent),
  `maxHeight` fijo (`min(58vh,620px)`) y el nuevo `fillParent` (flex puro).
  Converger hacia `fillParent` donde la tabla deba llenar la sección, y retirar
  el modo adaptativo (propenso a feedback loops al remontar).
- **Densidad y alineación**: montos a la derecha con tabular-nums y separador
  dominicano consistente; fechas en formato único; columnas numéricas alineadas.
- **Color-coding**: créditos/débitos y `transfer`/`fx_exchange` (atenuados) con
  una paleta única reutilizable; estados de factura/licencia con badges
  consistentes.
- **Sticky header/footer** y scroll interno uniforme (ya parcialmente con
  `table-shell--fill`).
- **Empty states** y skeletons consistentes entre tablas.

## 3. Mejoras de sync (indicadores y conflictos)

- **Indicadores de estado** visibles por entidad: pendiente de subir / subido /
  error, en vez de depender solo del panel de `sync_outbox`.
- **Conflictos**: hoy el dedupe cross-máquina se resuelve con prompt manual
  (Facturas) y skip por content-hash (archivos misma-máquina). Falta una UI
  general de reconciliación reutilizable más allá del banner de Invoice Inbox.
- **Reintentos visibles**: superficie en UI para reintentar filas fallidas por
  entidad (existe a nivel global en app-IPC; falta contextual).
- **Hidratación limpia**: completar pull de catálogos fundacionales pendientes
  (ver `sync-pull-inbox-audit-2026-05-24.md`).
- **Tombstones / deletes**: estrategia uniforme de borrado propagado para los
  dominios que aún no la tienen.

## 4. Dedupe / archivos (dependencias abiertas)

- **Archivos cross-máquina**: el dedupe por `content_hash` en `fileUploadService`
  es **misma-máquina** porque las filas de `asset_files`/`incident_files`/etc.
  no sincronizan todavía. Cuando esos archivos sincronicen (extensión del patrón
  de A2/Storage), habilitar reconciliación cross-máquina como en Facturas.
- **Reconciliación genérica**: extraer el detector de grupos duplicados
  (`findDuplicateGroups`) a un helper reutilizable para licencias/honorarios si
  surge el caso cross-máquina.

## 5. Overview / reportes

- Integrar facturado (Fase 2) + gasto real (Treasury) en un único overview con
  toggle mes/quarter/año (parcialmente hecho con `resolveFinanceOverviewWindow`).
- Reportes fiscales (606/607) — pendientes de confirmación de estructura con
  Jeannette (out of scope hasta entonces).

---

## Priorización sugerida (cuando se abra la fase)

| Item | Impacto | Esfuerzo |
|------|---------|----------|
| 2. Convergencia de altura de tablas a `fillParent` | Alto (bugs de scroll) | M |
| 3. Indicadores de estado de sync | Alto (confianza del equipo) | M |
| 1. Unificación de estilos finance | Medio | L |
| 2. Densidad/alineación/color-coding | Medio | M |
| 4. Dedupe cross-máquina de archivos | Medio (depende de sync de archivos) | L |
| 3. UI de reconciliación general | Medio | M |

Cada item deja el app coherente si se ataca aislado.
