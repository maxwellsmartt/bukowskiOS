# Sync Pull / Inbox Audit — 2026-05-24

## Objetivo

Auditar qué datos de bukowskiOS ya pueden hidratar una instalación limpia desde Supabase y cuáles sólo salen por `sync_outbox` o viven directo en Supabase sin cache local.

Este documento prioriza el caso real: Carlos o Iván instalan una versión nueva, hacen login en el workspace correcto y necesitan ver la información operativa/financiera sin depender de la máquina original.

## Resumen Ejecutivo

Estado general: el sync local-first está parcialmente armado, pero no es todavía un “full workspace hydration”.

- `OK`: catálogos parciales, assets y snapshots operativos sí tienen pull local.
- `Riesgo crítico`: Treasury, quotes, invoices, finance entries y collaborator fees/payments pueden subir o tienen tablas remotas, pero no tienen pull local inverso para una instalación limpia.
- `Riesgo crítico`: `financial_entry`, `quote`, `invoice`, `invoice_payment`, `currency_settings` y `exchange_rate` escriben outbox, pero el transport no los materializa hoy a tablas de dominio salvo exchange rates por pull directo. Varias filas sólo llegan a `public.sync_outbox`.
- `Riesgo medio`: Inbox/notifications/todos/reminders/software licenses no siguen el patrón local-first. Funcionan directo contra Supabase en UI, pero no hidratan SQLite ni tienen modo offline real.
- `Riesgo medio`: algunos catálogos que el pull intenta leer (`clients`, `manufacturers`, `production_companies`) no tienen tablas Supabase fundacionales completas en migrations; hay comentarios explícitos de deuda en quotes/currency.

## Arquitectura Actual

### Push / Outbox

El worker `syncOutboxWorkerService` toma filas locales de `sync_outbox` y usa `createSupabaseOutboxTransport`.

El transport hace tres cosas:

1. Para `asset_event`: materializa `assets`, `asset_current_state`, `asset_events`.
2. Para `project`, `packing_slip`, `incident`, `rma_case`: materializa `operational_snapshots`.
3. Para tipos cubiertos por `resolveSupabaseDomainUpserts`: materializa tablas financieras/treasury específicas.
4. Siempre sube también la fila a `public.sync_outbox` como log remoto.

### Pull / Hidratación

Estado actualizado 2026-05-24:

- Implementado pull local para Treasury y honorarios/pagos a colaboradores en `AppShell`.
- Se agregaron contratos IPC, apply local idempotente con guard de outbox y tests de hidratación limpia.
- Siguen pendientes quotes/invoices/finance entries/currency settings y catálogos fundacionales completos.

Antes de este slice existían tres pulls locales en `AppShell`:

- `useCatalogPull`
- `useAssetSnapshotPull`
- `useOperationalSnapshotPull`

No existe un pull genérico de `public.sync_outbox`, y eso es correcto por ahora: usar `sync_outbox` remoto como “source of truth” sería frágil. La hidratación debe venir de tablas de dominio o snapshots.

## Matriz de Cobertura

| Dominio | Sube desde local | Materializa tabla/snapshot remoto | Baja a instalación limpia | Estado |
| --- | --- | --- | --- | --- |
| Workspaces | Directo/ensure local cache | `workspaces` | `ensureRemoteWorkspaces` cachea locales | Parcial |
| User profiles / memberships / roles / permissions | Supabase directo / migrations | Sí | Supabase directo | OK para auth/settings |
| User settings | Supabase directo | `user_settings` | Hidratación directa + cache localStorage | OK, no SQLite |
| Notifications | Supabase directo | `notifications` | Query + realtime directo | OK online, no local-first |
| Todos / reminders | Supabase directo | `todos`, `reminders` | Query directo + polling/realtime parcial | OK online, no local-first |
| Software licenses | Supabase directo | `software_licenses` | Query directo al abrir página | OK online, no local-first |
| Asset categories | No claro para writes locales actuales | `asset_categories` | `useCatalogPull` | OK parcial |
| Locations | No claro para writes locales actuales | `locations` | `useCatalogPull` | OK parcial |
| Clients | Local existe | Tabla remota no garantizada | `useCatalogPull` intenta leerla | Riesgo medio |
| Manufacturers | Local existe | Tabla remota no garantizada | `useCatalogPull` intenta leerla | Riesgo medio |
| Production companies | Local existe | Tabla remota no garantizada | `useCatalogPull` intenta leerla | Riesgo medio |
| Departments | Local existe | No vi tabla remota dedicada | Sólo via snapshots con tolerancia a faltantes | Riesgo medio |
| Assets | `asset_event` | `assets`, `asset_current_state`, `asset_events` | `useAssetSnapshotPull` | OK |
| Projects / units / crew assignments | `project` snapshot | `operational_snapshots` | `useOperationalSnapshotPull` | OK parcial |
| Packing slips | `packing_slip` snapshot | `operational_snapshots` | `useOperationalSnapshotPull` | OK parcial |
| Incidents | `incident` snapshot + algunos outbox legacy | `operational_snapshots` | `useOperationalSnapshotPull` | OK parcial |
| RMA cases | `rma_case` snapshot | `operational_snapshots` | `useOperationalSnapshotPull` | OK parcial |
| Treasury bank accounts | `bank_account` | `bank_accounts` | `useTreasuryPull` | OK parcial |
| Treasury imports / transactions | `bank_statement_import`, `bank_transaction` | `bank_statement_imports`, `bank_transactions` | `useTreasuryPull` | OK parcial |
| Treasury annotations / classifications | `transaction_annotation`, `counterparty_rule` | `transaction_annotations`, `counterparty_rules` | `useTreasuryPull` | OK parcial |
| Treasury allocations / links | `transaction_allocations`, `transaction_link` | `transaction_project_allocations`, `transaction_links` | `useTreasuryPull` | OK parcial |
| Collaborator fees/payments | `collaborator_fee`, `collaborator_payment` | Tablas remotas añadidas 2026-05-24 | `useCollaboratorPaymentPull` | OK parcial |
| Quotes | `quote` outbox | Tabla remota existe, pero resolver no materializa | No hay pull quotes | Crítico |
| Invoices | `invoice`, `invoice_payment` outbox | Tabla remota existe, pero resolver no materializa | No hay pull invoices | Crítico |
| Finance entries | `financial_entry` outbox | No vi tabla Supabase `financial_entries` | No hay pull finance entries | Crítico |
| Currency settings | `currency_settings` outbox | Tabla remota existe, pero resolver no materializa | No hay pull settings completo | Crítico |
| Exchange rates | `exchange_rate` outbox | Tabla remota existe, pero resolver no materializa deletes/updates desde outbox | `useCatalogPull` baja `exchange_rates` | Medio |

## Hallazgos por Severidad

### Blocker: no existe hidratación completa para Finance/Treasury

Impacto real:

- Carlos o Iván pueden instalar la app y no ver movimientos bancarios importados, clasificaciones, pagos de colaboradores, cotizaciones, facturas o entradas financieras aunque la máquina original ya los haya subido.
- Los gráficos de Treasury pueden verse vacíos o incompletos en una instalación limpia.
- La parte financiera queda inconsistente entre máquinas, justo el área más sensible.

Evidencia:

- Los únicos hooks de pull local son catalog/asset/operational.
- Ya existen `useTreasuryPull` y `useCollaboratorPaymentPull`.
- No hay `useQuotePull`, `useInvoicePull` ni `useFinancePull`.
- `resolveSupabaseDomainUpserts` cubre Treasury y collaborator fees/payments, pero no quotes/invoices/finance entries/currency settings.

Fix rápido aplicado:

1. Implementado `useTreasuryPull` + `financialDomainPullService` para:
   - `bank_accounts`
   - `bank_statement_imports`
   - `bank_transactions`
   - `transaction_annotations`
   - `transaction_project_allocations`
   - `transaction_links`
   - `counterparty_rules`
2. Implementado `useCollaboratorPaymentPull` + `financialDomainPullService` para:
   - `collaborator_fees`
   - `collaborator_payment_batches`
   - `collaborator_fee_payments`

Fix estructural:

- Crear un patrón `domainPullService` reutilizable con:
  - cursor por tabla
  - batch size
  - LWW por `updated_at` cuando exista
  - guard de outbox pendiente
  - orden explícito por dependencias
  - tests por tabla crítica

### Crítico: quotes/invoices escriben outbox pero no materializan tablas de dominio

Impacto real:

- Una cotización/factura puede quedar registrada en `public.sync_outbox` remoto como log, pero no aparecer en `public.quotes`, `public.quote_items`, `public.invoices`, `public.invoice_items` o `public.invoice_payments`.
- Aunque existan migrations Supabase para quotes/invoices, la ruta de push actual no las alimenta.

Fix rápido recomendado:

- Extender `resolveSupabaseDomainUpserts`:
  - `quote` -> upsert `quotes`, replace/upsert `quote_items`, upsert `quote_versions`.
  - `invoice` -> upsert `invoices`, replace/upsert `invoice_items`.
  - `invoice_payment` -> upsert `invoice_payments` + invoice actualizado.

Fix estructural:

- Implementar `quotePullService` e `invoicePullService`.
- Para deletes, no depender sólo de payload `{ deleted: true }` si no existe estrategia remota clara: usar soft-delete/status cuando sea posible.

### Crítico: finance entries no tiene tabla remota visible

Impacto real:

- `financial_entry` escribe outbox local, pero no hay tabla `public.financial_entries` en migrations Supabase.
- Cualquier entrada manual de finanzas queda local o, como mucho, como log en `public.sync_outbox`.

Fix rápido recomendado:

- Crear migration Supabase para `financial_entries` que refleje SQLite.
- Agregar resolver en `resolveSupabaseDomainUpserts`.
- Agregar pull service o incluirlo en `financeDomainPullService`.

### Crítico: currency settings outbox no materializa `currency_settings`

Impacto real:

- Configuración de moneda, ITBIS default, validez de cotizaciones, imágenes de firma/sello/logo y secuencia NCF pueden no sincronizarse por outbox.
- Invoices dependen de NCF y `currency_settings`; si otra máquina no recibe esa configuración, puede emitir o leer mal.

Fix rápido recomendado:

- Agregar `currency_settings` al resolver de domain upserts.
- Crear pull de `currency_settings` con guard fuerte: si hay outbox local pendiente, no sobreescribir.

### Crítico: no hay pull Treasury

Impacto real:

- Ya tenemos schema Supabase para Treasury y push de importaciones/clasificaciones, pero otra máquina no baja esos datos.
- Los “quick wins” de categorización masiva quedan atrapados en la máquina que hizo la clasificación.

Estado actualizado:

- Pull de Treasury implementado antes del hardening visual.
- Orden de aplicación:
  1. `bank_accounts`
  2. `bank_statement_imports`
  3. `bank_transactions`
  4. `transaction_annotations`
  5. `transaction_project_allocations`
  6. `transaction_links`
  7. `counterparty_rules`

### Medio: Inbox no es local-first, pero sí hidrata online

Impacto real:

- Notifications/todos/reminders funcionan directo contra Supabase y se ven en una instalación limpia online.
- Pero si hay mala conexión, no hay cache SQLite ni outbox local.
- No bloquea la operación financiera, pero sí limita confiabilidad offline.

Fix recomendado:

- Mantener así por ahora si el foco es Finance/Treasury.
- Más adelante, decidir si Inbox debe ser local-first o explícitamente cloud-first.

### Medio: catálogos remotos incompletos

Impacto real:

- `useCatalogPull` intenta bajar `clients`, `manufacturers`, `production_companies`, pero las migrations Supabase no garantizan esas tablas.
- Quotes/invoices guardan snapshots de nombres, lo cual reduce daño, pero proyectos y reportes pueden perder referencias vivas.

Fix recomendado:

- Crear schema remoto completo para:
  - `clients`
  - `manufacturers`
  - `production_companies`
  - `departments`
  - `crew_members`
- Luego expandir catalog pull.

## Orden Recomendado de Implementación

### Slice 1 — Pull financiero mínimo viable

Prioridad: alta.

Estado: implementado.

Incluye:

1. `financialDomainPullService` + `useTreasuryPull`.
2. `financialDomainPullService` + `useCollaboratorPaymentPull`.
3. Tests de instalación limpia simulada aplicando rows remotos a SQLite local.

Por qué primero:

- Es lo que directamente afecta estados de cuenta, categorización, pagos a colaboradores y gráficos.

### Slice 2 — Materialización de quotes/invoices/currency/finance entries

Prioridad: alta.

Estado: pendiente crítico.

Incluye:

1. Resolver domain upserts para `quote`, `invoice`, `invoice_payment`, `currency_settings`, `exchange_rate`.
2. Migration `financial_entries`.
3. Pull para quotes/invoices/settings/entries.

Por qué segundo:

- Evita que `sync_outbox` sea un log muerto para finanzas reales.

### Slice 3 — Catálogos fundacionales

Prioridad: media.

Incluye:

1. Supabase schema para clients/manufacturers/production companies/departments/crew.
2. Pull idempotente.
3. Resolver de outbox si existen mutaciones locales.

### Slice 4 — Inbox local-first o decisión cloud-first

Prioridad: media/baja.

Incluye:

1. Decidir si notifications/todos/reminders/software licenses deben vivir en SQLite también.
2. Si sí: outbox local + pull local.
3. Si no: documentar que son cloud-first y mejorar estados offline.

## Smoke Tests Recomendados

### Smoke multi-máquina simulado

1. Crear DB local A.
2. Crear cuenta bancaria, importar estado, clasificar movimientos, crear honorario, aprobar y pagar parcial.
3. Ejecutar worker outbox con transport Supabase mock.
4. Crear DB local B limpia.
5. Aplicar pull remoto por dominio.
6. Verificar:
   - balances de Treasury iguales
   - categorías iguales
   - honorarios y pagos iguales
   - gráficos usan los mismos totales

### Smoke Supabase real

1. En Mac principal: importar/clasificar/pagar.
2. Esperar outbox sent.
3. En Mac secundaria: login mismo workspace.
4. Confirmar que baja sin tocar seed local.
5. Revisar `sync_pull_cursors` y errores visibles.

## Decisión Recomendada

Antes de seguir con hardening visual de Treasury, implementar Slice 1.

Razón: si la UI queda hermosa pero Carlos/Iván no reciben movimientos, clasificaciones y pagos en instalación limpia, el problema operativo sigue siendo crítico. Primero hacemos que el dato viaje; luego pulimos cómo se ve.
