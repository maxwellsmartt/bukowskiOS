# BukowskiOS — Sync roadmap v1

> Estado reconciliado el 2026-06-22. Fuente canónica de findings: [`sync-findings-register-2026-06-22.md`](./sync-findings-register-2026-06-22.md). Este roadmap conserva decisiones y evolución histórica; cualquier lista antigua de riesgos queda subordinada al registro canónico.

## Estado vigente 2026-06-22

- Implementación local de push/pull, clocks, identidades, tombstones, archivos y observabilidad: `closed`.
- Inbox/preferences cloud-first y artefactos regenerables: `accepted`.
- Aplicación de la migración `workspace_files`, smoke real multiusuario y validación RLS: `open`.
- UX de conflictos sensibles reales: `open` como hardening; no justifica un merge genérico sin casos reproducibles.

## Estado actual
- BukowskiOS es **local-first**
- el contrato local ya existe vía `sync_outbox`
- `packages/sync` ya define los límites mínimos:
  - `outbox/types.ts`
  - `mappers/index.ts`
  - `transport/index.ts`
- ya existe worker real de outbox con retry/backoff y transport Supabase opt-in
- ya existe push remoto para assets y snapshots operativos
- ya existe pull remoto para catálogos/assets y snapshots operativos

## Qué ya está bien sembrado
- todas las mutaciones críticas escriben `command_receipts`
- varias mutaciones ya escriben `sync_outbox`
- el outbox conserva:
  - `workspace_id`
  - `entity_type`
  - `entity_id`
  - `operation_type`
  - `payload_json`
  - `status`
  - `attempt_count`
  - `last_error`
  - `next_retry_at`

Eso nos da una base buena para un sync **idempotente, auditable y reintentable**.

## Actualización 2026-05-06

Se detectó y corrigió una deuda crítica del pull operacional:

- Sí había snapshots remotos de proyectos y packing slips en Supabase.
- El apply local fallaba con:
  - `FOREIGN KEY constraint failed` en proyectos creados en casa con referencias opcionales de catálogo no presentes localmente.
  - `FOREIGN KEY constraint failed` en packing slips cuyo proyecto/unit todavía no había aplicado.
  - `UNIQUE constraint failed` en `packing_slip_items(packing_slip_id, asset_id)` cuando el item remoto tenía otro `id` pero representaba el mismo asset/slip.
- El cursor de pull avanzaba aunque algunas filas fallaran, así que esas filas podían quedar detrás del cursor y no reintentarse.

Fix aplicado:

- El cursor operacional ahora solo avanza cuando una fila se aplicó o se saltó por una razón segura.
- El renderer reconsulta con lookback de 14 días para recuperar máquinas que ya tenían cursores adelantados.
- Projects tolera `client_id`, `production_company_id` y departamentos faltantes como referencias opcionales, preservando snapshots de nombre.
- Packing Slip reintenta cuando falta project/unit y upsertea items por `(packing_slip_id, asset_id)`.
- Verificación: `corepack pnpm --filter @bukowski/desktop test -- operational-snapshot-service`, `typecheck` y `build` pasan.

## Actualización 2026-05-24

Se auditó la cobertura completa de pull/hidratación para instalaciones limpias:

- Documento: [`sync-pull-inbox-audit-2026-05-24.md`](./sync-pull-inbox-audit-2026-05-24.md)
- Hallazgo principal inicial: catalog/asset/operational snapshots sí tenían pull local, pero Finance/Treasury no hidrataba una instalación limpia de forma completa.
- Fix aplicado: Treasury, collaborator fees/payments, quotes, invoices, invoice payments, finance entries y currency settings ya tienen materialización remota y pull local por dominio.
- Cerrado posteriormente: catálogos fundacionales y estrategia de deletes/tombstones (`SYNC-005`, `SYNC-007`).

## Actualización 2026-06-08 - matriz histórica de cobertura por pantalla

> Esta matriz conserva el corte del 2026-06-08. Storage universal, tombstones, catálogos y UX stale avanzaron después; consultar el registro canónico para el estado vigente.

Objetivo del slice: dejar una vista operativa clara de qué pantallas ya sincronizan datos entre Macs/usuarios del mismo workspace y qué falta validar antes de declarar "full workspace sync".

Nota importante:

- **Datos del workspace**: facturas, movimientos, cuentas, proyectos, notificaciones, todos, etc. Deben ser visibles para Carlos/Jeannette/Iván según permisos/RLS.
- **Preferencias visuales por usuario**: orden/ancho/visibilidad de columnas, idioma, fecha, notificaciones nativas. No deben cambiarle la UI a otros usuarios salvo que diseñemos un setting de workspace. Facturas ya sincroniza su layout de tabla en `user_settings.settings.tablePreferences`, por usuario.

### Matriz MVP de cobertura

| Pantalla / dominio | Datos principales | Push local -> remoto | Pull remoto -> local | Conflictos actuales | RLS / permisos | Archivos / storage | Qué falta |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Tesorería - Resumen / movimientos | `bank_accounts`, `bank_statement_imports`, `bank_transactions`, `transaction_annotations`, `transaction_project_allocations`, `counterparty_rules`, `exchange_rates` | Sí vía `sync_outbox` y `resolveSupabaseDomainUpserts`; tasas también tienen flujo propio. | Sí vía `useTreasuryPull` + `applyRemoteTreasuryRows`; exchange rates bajan por catalog/currency flow. | LWW por `updated_at` donde aplica; guard de outbox pendiente evita pisar cambios locales. No hay UI de conflicto. | Debe depender de membership/workspace RLS en tablas remotas; falta auditoría RLS final tabla por tabla. | Estados bancarios importados no se sincronizan como archivo fuente; se sincronizan filas parseadas. | Smoke multiusuario real con dos Macs, errores visibles por fila y estrategia de delete/tombstone para imports. |
| Facturas / Invoice Inbox | `invoice_extractions`, `invoice_extraction_projects`, `transaction_links`, `bank_accounts`, `bank_transactions` | Sí: alta/edición/usuario/proyecto/estado factura encola `invoice_extraction`; medio de pago encola `transaction_link`. | Sí vía `useFinanceBusinessPull` para `invoice_extractions` y child rows; `useTreasuryPull` para `transaction_links`. | LWW + reemplazo completo de tags de proyecto por factura; no hay merge campo-a-campo ni cola visual de conflictos. | Debe estar workspace-scoped; falta reauditar policies Supabase específicas para `invoice_extractions` y `invoice_extraction_projects`. | Documento local usa `storage_path` / `storage_object_key`; metadata sync sí, disponibilidad real del PDF depende de storage/upload. | Smoke: subir/editar factura en Mac A, confirmar PDF/metadata/proyecto/medio en Mac B. Hardening: dedupe cross-machine por `content_hash` + storage bucket RLS. |
| Cuentas y medios de pago | `bank_accounts`, reminders automáticos para tarjetas | Sí vía `bank_account`; no sube números completos, sólo metadata segura/máscara/last4. | Sí vía `useTreasuryPull`. | LWW por `updated_at`; no hay resolución específica si dos usuarios editan la misma cuenta a la vez. | Crítico: confirmar grants/RLS para que sólo miembros autorizados del workspace lean medios. | No aplica archivo; cuidado con no persistir secretos o números completos. | Smoke multiusuario de crear/editar/desactivar cuenta; auditoría de que `account_number_full` no viaje remoto. |
| Finanzas - entradas, cotizaciones, facturas comerciales | `financial_entries`, `quotes`, `quote_items`, `quote_versions`, `invoices`, `invoice_items`, `invoice_payments`, `currency_settings` | Sí vía materialización de dominio en outbox. | Sí vía `useFinanceBusinessPull`. | LWW/child replace para items; no hay diff visual si dos usuarios editan la misma quote/invoice. | Falta reauditar RLS/grants de tablas Finance después de los últimos slices. | PDFs generados/exportados no son source of truth; logos/sellos/firma dependen de storage/settings. | Smoke real de crear quote/invoice/pago en A y ver en B; validar numbering/sequences cross-device. |
| Equipos / Assets | `assets`, `asset_current_state`, `asset_files`, operaciones de asignación/movimiento, imágenes y vínculos con packing slips | Sí para creación, edición, archivo, asignación/movimiento y packing slips vía servicios locales + `sync_outbox`/snapshots operativos. Import CSV MVP sigue creando fila por fila con resumen visible de importadas/skipped/fallidas; no es bulk transaccional. | Parcial/OK por snapshots de assets (`useAssetSnapshotPull`) y snapshots operativos para packing/proyectos; requiere smoke entre máquinas para confirmar archivos/imágenes end-to-end. | LWW/snapshot completo; sin merge campo-a-campo. Import CSV puede quedar parcial si falla a mitad, aunque ahora muestra progreso y fila fallida. | Debe mantenerse workspace-scoped; validar RLS de snapshots/assets remotos y que roles sin permiso no puedan mutar inventario. | Metadata de archivos/imágenes se enlaza al asset; disponibilidad real depende de storage/local file service y debe probarse con otra Mac. | Smoke multiusuario: crear, editar, archivar, asignar/mover, subir imagen, crear packing slip en Mac A y validar Mac B. Fix definitivo CSV: comando bulk idempotente/transaccional o batch local con rollback/receipt auditable. |
| Proyectos / unidades / packing / incidents / RMA | `operational_snapshots` para `project`, `packing_slip`, `incident`, `rma_case`; tablas locales materializadas desde snapshot | Sí vía snapshots operativos y backfill desde Sync Activity. | Sí vía `useOperationalSnapshotPull` con lookback y apply idempotente. | LWW por snapshot completo; tolera dependencias faltantes y reintenta. Sin UI de merge. | RLS en `operational_snapshots` por workspace membership; validar roles finos si se requiere. | Archivos adjuntos operativos no están cubiertos como storage universal en esta matriz; PDFs de packing se regeneran localmente desde datos sincronizados. | Packing Slips ya tiene matriz S2.2 en `packing-slips-audit-v1.md`; falta smoke real Mac A/Mac B para creación, devolución parcial/total, estado y assets afectados. |
| Catálogo | `asset_categories`, `locations`, `clients`, `manufacturers`, `production_companies`, `departments`, crew/roles según flujo | Parcial: algunos writes materializan `client`, `manufacturer`, `production_company`; otros catálogos dependen de seeds/migrations/direct Supabase. | Parcial vía `useCatalogPull`. | Parcial; no hay tombstones ni merge completo. | Riesgo medio: confirmar RLS y tablas remotas fundacionales completas. | No aplica normalmente; logos/branding son otro flujo. | Cerrar inventario de catálogos: qué tablas existen remoto, cuáles escriben outbox, cuáles sólo seed local. |
| Todos / Reminders | `todos`, `reminders`; algunos creados por usuario/agente/tarjetas | Sí vía `notificationLocalService`/outbox para local-first; provider también consulta Supabase. | Parcial: `NotificationsProvider` consulta remoto y aplica filas locales; no está integrado al `financialDomainPullService`. | LWW básico por fila; recurrencias/snooze/completed pueden pisarse si se editan simultáneamente. | RLS por `user_id`/`workspace_id` debe validarse; acciones de agente deben preservar usuario/workspace. | No aplica archivo. | Smoke offline/online; documentar si todos/reminders son por usuario o compartidos por workspace. |
| Notifications / Inbox | `notifications`, `todos`, `reminders`, preferencias nativas en `user_settings` | Sí para notificaciones locales y acciones; preferencias nativas van por `user_settings`. | Sí/parcial: realtime + polling remoto + cache local. | Notificaciones son append/update; no hay UI de conflicto. | RLS sensible por usuario/workspace; falta auditoría final de policies y native action approval. | No aplica archivo. | Confirmar que tray/popover/Inbox muestran lo mismo en nueva máquina; hardening de permisos macOS y acciones nativas. |
| Preferencias de tabla / UI | `user_settings.settings.tablePreferences` por usuario | Sí directo a Supabase vía `setUserSetting`; Facturas activado. | Sí por `UserSettingsProvider` realtime/cache. | Remote settings son autoritativos; no merge profundo de cambios simultáneos. | RLS de `user_settings` por usuario. | No aplica. | Decidir si alguna tabla necesita layout compartido por workspace (`workspace_table_preferences`) en vez de por usuario. |

### Prioridad recomendada

1. **MVP / confianza operativa**: smoke multiusuario real de Facturas, Cuentas y Movimientos con dos Macs y dos usuarios, revisando `sync_outbox`, pull cursors y Supabase.
2. **MVP / cobertura**: inventario de Catálogo para cerrar tablas que aún son parciales (`clients`, `production_companies`, `manufacturers`, `departments`, crew/roles).
3. **Hardening**: auditoría Supabase/RLS por tabla de Finance/Treasury/Notifications y verificación de storage buckets para PDFs/branding/adjuntos.
4. **Hardening**: UI de conflictos/estado por fila cuando una pantalla depende de sync para que el usuario no confíe en datos stale.
5. **Optimización**: mover preferencias compartibles de UI a nivel workspace sólo donde aporte valor; mantener preferencias personales en `user_settings`.

## Qué no debemos hacer todavía
- no abrir sync real antes de estabilizar identidad de workspace
- no mezclar transporte remoto con lógica de dominio
- no introducir merge/conflict logic compleja antes de tener casos reales

## Fases recomendadas

### Fase 1 — Outbox worker local
Estado: **Done**

Objetivo:
- procesar `sync_outbox` sin tocar aún un backend real

Incluye:
- selector de filas `pending` / `failed`
- transición de estado:
  - `pending` -> `processing`
  - `processing` -> `sent`
  - `processing` -> `failed`
- backoff básico por `attempt_count`
- logs claros por entity/operation

Qué probar:
- retries idempotentes
- no reprocesar filas `sent`
- marcar `failed` con error útil

### Fase 2 — Mappers por dominio
Estado: **Done**

Objetivo:
- separar payload local de payload remoto

Orden recomendado:
1. assets
2. projects + units
3. incidents
4. packing
5. finance

Regla:
- los mappers no leen UI
- los mappers no cambian estado local
- solo traducen payloads

### Fase 3 — Transport adapter real
Estado: **Done en código; validación operativa abierta**

Objetivo:
- conectar el outbox a un destino real sin cambiar dominio

Opciones:
- Supabase
- API propia
- bucket/log sink intermedio

Requisitos:
- auth por workspace
- timeouts y retries
- idempotency key por fila del outbox

### Fase 4 — Pull / reconciliation
Estado: **Done en código; hardening operativo abierto**

Objetivo:
- aceptar cambios remotos de vuelta

Estado actual:
- Catalog/asset/finance/files pull usa cursores compuestos y apply idempotente.
- Operational snapshots usa snapshots por entidad (`project`, `packing_slip`, `incident`, `rma_case`).
- Tombstones convergen deletes y `workspace_files` cubre metadata/Storage/caché.
- Quedan `SYNC-017` a `SYNC-020` como gates de infraestructura, smoke, RLS y conflictos sensibles.

## Estrategia de conflicto recomendada
- default inicial: `last writer wins` solo para campos seguros
- para operaciones sensibles:
  - no mezclar automáticamente
  - crear incidente de sync o cola de revisión

Casos sensibles:
- asignaciones de assets
- packing returns
- estados de incidentes
- ajustes financieros

## Principios no negociables
- el dominio local sigue siendo la fuente operativa inmediata
- sync nunca debe bloquear una mutación local
- cada retry debe ser seguro de repetir
- cada payload remoto debe ser trazable a un `command_receipt` o `sync_outbox.id`

## Dependencias previas
- `LOCAL_FALLBACK_WORKSPACE_ID` ya centralizado en código vivo
- retention básica para no dejar crecer indefinidamente `sent` outbox y telemetría auxiliar
- hardening de packaging y recovery ya resueltos
- hardening de startup local: la ventana de carga aparece antes de la inicialización SQLite y el bootstrap del project wizard ya tolera workspace demo ausente/referencias opcionales huérfanas

## Riesgos abiertos

La lista histórica fue reemplazada por los findings `SYNC-017` a `SYNC-020` del registro canónico:

- `SYNC-017`: migración y Storage de `workspace_files` en Supabase.
- `SYNC-018`: smoke real multiusuario/multimáquina.
- `SYNC-019`: validación RLS efectiva por rol.
- `SYNC-020`: UX de conflictos sensibles reales.

El DMG, OAuth/MFA y el modelo general de Agents pertenecen a otros tracks. El demo fijo y la contaminación de workspaces remotos quedaron cerrados en `60e784d1`.
