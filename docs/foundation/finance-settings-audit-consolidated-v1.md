# Finance + Settings Audit Consolidated v1

Ultima actualizacion: `2026-05-22`

Este documento consolida las auditorias y handoffs relacionados con Finance,
Settings, pagos, honorarios, facturacion y colaboradores. El objetivo es dejar
una sola lectura operativa: que ya existe, que falta, en que orden conviene
implementarlo y cuales son los quick wins con mayor impacto.

## Fuentes revisadas

- `docs/foundation/finance-shell-v1.md`
- `docs/foundation/finance-quotes-v1.md`
- `docs/foundation/schema-v1.md`
- `docs/foundation/app-hardening-roadmap-v1.md`
- `docs/foundation/visual-fidelity-audit.md`
- `.claude/worktrees/flamboyant-hugle-af70d4/CLAUDE.md`
- Codigo actual de Finance, Settings, invoices, currency, crew catalog y DB migrations.

Nota sobre Claude: en este checkout no existe un archivo de auditoria de Claude
como tal. Solo existe `CLAUDE.md`, que exige leer `graphify-out/GRAPH_REPORT.md`;
esa carpeta no existe en el repo actual. Se toma como gap de trazabilidad, no
como blocker funcional.

## Estado actual consolidado

### Implementado

- Finance shell con overview, cost links y entries.
- Finance entries con create/update desde UI, documentos adjuntos, idempotencia
  por `command_receipts` y registro en `sync_outbox`.
- Cotizaciones con monedas DOP/USD/EUR, snapshot de tasa, ITBIS flexible,
  numeracion, versiones auditables y PDF.
- Facturas manuales y desde quote, con estado fiscal separado del numero
  comercial.
- Emision de factura con consumo atomico de NCF desde `currency_settings`.
- Pagos de facturas en `invoice_payments`, con `paid_amount`,
  `outstanding_amount`, estados `issued`, `partially_paid` y `paid`.
- Settings de workspace para moneda base, ITBIS default, vigencia de quote,
  Sirecine, tasas manuales, proveedor de tasas y NCF.
- Branding de workspace para PDFs.
- Roles y permisos base para finance, quotes, invoices y currency settings.
- Crew catalog enriquecido con departamento, documento y cuentas bancarias.
- Project units permiten asignar crew y detectar solapes de disponibilidad.

### Parcial

- `financial_entries` funciona como ledger operativo inicial, pero no como
  contabilidad completa.
- `collaborator_fees` existe en schema local inicial, pero no tiene servicio,
  contratos, UI, Supabase/RLS ni sync real.
- Los pagos existentes son pagos recibidos contra facturas de clientes, no pagos
  salientes a tecnicos o colaboradores.
- Crew tiene datos bancarios, pero no hay flujo de honorarios, aprobacion,
  liquidacion ni historial de pagos por colaborador.
- Settings muestra permisos y roles, pero el coverage visual de permisos no
  incluye todas las llaves nuevas de `quotes.*`, `invoices.*` y
  `currency.manage_rates` en el resumen compacto.

### No implementado

- Modulo de honorarios por tecnico/colaborador.
- Historial de pagos salientes a colaboradores.
- Estados de aprobacion/pago para honorarios.
- Link fuerte entre project/unit/crew assignment y fee esperado.
- Generacion de cuentas por pagar desde crew assignments.
- Reporte de deuda pendiente por tecnico, proyecto o unidad.
- Export PDF/CSV de pagos a colaboradores.
- Permisos dedicados tipo `crew_fees.read`, `crew_fees.manage`,
  `crew_payments.record`.
- Supabase schema/RLS para honorarios y pagos salientes.
- Reconciliacion bancaria o payment links.

## Riesgos por impacto real

### Blocker

- No hay flujo end-to-end para pagar tecnicos/colaboradores. Operativamente,
  Finanzas puede facturar y registrar cobros de clientes, pero no puede saber
  cuanto debe pagar al crew, que ya fue pagado, ni auditar pagos por proyecto.

### Critico

- `collaborator_fees` aparece en `schema-v1.md` y en SQLite, pero no esta
  implementado como feature. Esto puede dar una falsa sensacion de cobertura y
  generar deuda si se empieza a meter informacion de honorarios en
  `financial_entries` sin reglas claras.
- Los datos bancarios de crew existen, pero son sensibles. Antes de exponerlos
  mas en UI hay que revisar permisos, visibilidad y logs para evitar fugas
  innecesarias.

### Medio

- Finance entries no tienen archive/delete compensatorio. Para errores
  operativos hoy hay que editar la entry, lo cual es menos auditable que crear
  una reversa o marcarla anulada.
- El resumen visual de permisos en Settings puede quedar incompleto frente a
  permisos nuevos. Eso confunde a admins no tecnicos.
- Money sigue guardado como `REAL` con redondeo a 2 decimales. Es aceptable
  para MVP, pero no ideal para liquidaciones extensas o conciliacion futura.

### Bajo

- El documento `current-handoff-v1.md` esta desactualizado frente al estado
  actual de Finance.
- No existe `graphify-out`, aunque `CLAUDE.md` lo exige.

## Orden recomendado

### Fase 1 - MVP de pagos a colaboradores

Objetivo: poder responder "cuanto debo, a quien, por que proyecto y que ya
pague" sin contabilidad completa.

Dependencias:

- Backend: migraciones SQLite, contratos, mutation/read services e idempotencia.
- Frontend: vista Finance para fees/pagos y lectura en Project/Crew.
- Infra: ninguna obligatoria para validar local-first; Supabase queda para Fase 2.

1. Crear contratos y migraciones para `collaborator_fees` y
   `collaborator_payments`.
2. Vincular fee a `crew_member_id`, `project_id`, `project_unit_id` opcional,
   `department_id` opcional y `source_assignment_id` opcional.
3. Estados minimos: `draft`, `approved`, `scheduled`, `paid`, `cancelled`.
4. Crear servicios idempotentes: create/update/approve/recordPayment/cancel.
5. Agregar vista en Finance: `Collaborator Fees` o `Crew Payments`.
6. Mostrar en detalle de crew o project una lectura simple de deuda/pagos.

Prueba de fase: crear fee para un tecnico, aprobarlo, registrar pago parcial o
total, verificar historial y outstanding por proyecto.

### Fase 2 - Hardening

Dependencias:

- Backend: permisos, validaciones, audit trail y outbox.
- Frontend: Settings roles/permissions y filtros operativos.
- Infra: Supabase schema, RLS y sync.

1. Permisos dedicados y coverage claro en Settings.
2. RLS Supabase + sync outbox para honorarios y pagos.
3. Audit trail con reversas o anulaciones, no borrado fisico.
4. Validaciones de doble pago, monto negativo, moneda/tasa y pago mayor que
   saldo.
5. Filtros por proyecto, tecnico, estado, fecha y metodo de pago.

Prueba de fase: reintentar el mismo command id, simular mala conexion, verificar
que no duplica pagos y que el outbox queda reintentable.

### Fase 3 - Optimizacion

Dependencias:

- Backend: generadores desde assignments, export builders y posible refactor de money.
- Frontend: dashboards, exports y affordances de aprobacion mas rapidas.
- Infra: opcional, solo si se conectan bancos/payment links.

1. Generar honorarios sugeridos desde project unit crew assignments.
2. Export PDF/CSV por tecnico/proyecto/periodo.
3. Dashboard de cuentas por pagar.
4. Refactor gradual de money a integer minor units si el alcance contable crece.

Prueba de fase: crear proyecto con units y crew, generar honorarios sugeridos,
editar excepciones y exportar liquidacion.

## Quick wins mas efectivos

1. Actualizar Settings role coverage para mostrar `quotes.*`, `invoices.*`,
   `currency.manage_rates` y futuros permisos de crew payments.
2. Renombrar o documentar `collaborator_fees` como placeholder hasta que tenga
   servicio/UI, para evitar uso accidental.
3. Agregar una vista inicial read-only de "Crew payment readiness" que cruce
   crew, banco, proyectos asignados y falta de fee.
4. Agregar entry types/categorias sugeridas para `crew_fee` y
   `crew_payment` solo si se define claramente que son temporales.
5. Crear tests de contrato para que pagos de factura y pagos a colaboradores no
   se mezclen.

## Decisiones que conviene tomar antes de implementar

- Si los honorarios nacen manualmente o se sugieren desde asignaciones de crew.
- Si un pago a colaborador puede cubrir varios fees o siempre uno a uno.
- Si el beneficiario canonico debe ser `crew_members` o `users`. Recomendacion:
  `crew_members`, con `linked_user_id` opcional, porque no todo tecnico sera
  usuario interno.
- Si `financial_entries` debe reflejar pagos a colaboradores como proyeccion
  resumida o si `collaborator_payments` sera la fuente de verdad. Recomendacion:
  fuente de verdad dedicada y proyeccion opcional a Finance overview.

## Archivos clave para el siguiente slice

- `packages/db/src/migrations/0001_foundation.sql`
- `packages/contracts/src/commands/finance-commands.ts`
- `packages/contracts/src/validation/mutation-schemas.ts`
- `packages/contracts/src/queries/finance-queries.ts`
- `apps/desktop/electron/main/services/data/financeMutationService.ts`
- `apps/desktop/electron/main/services/data/financeReadService.ts`
- `apps/desktop/src/features/finance/FinanceEntriesPage.tsx`
- `apps/desktop/src/features/admin/SettingsPage.tsx`
- `apps/desktop/src/features/admin/CustomRolesEditor.tsx`
- `apps/desktop/src/features/projects/ProjectUnitsManager.tsx`
- `apps/desktop/electron/main/services/data/projectReadService.ts`

## Recomendacion de producto

No mezclar pagos a tecnicos dentro de invoice payments. `invoice_payments` son
cobros de clientes; pagos salientes a crew necesitan su propio modelo,
permisos, estados y auditoria. Meter ambos en una misma tabla ahora seria rapido,
pero generaria deuda tecnica y confusion operativa justo en la parte mas
sensible del negocio.
