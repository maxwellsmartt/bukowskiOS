# Roadmap v4 — Medios de Pago, Conciliacion y Reembolsos

> Los pendientes de sync/RLS/storage se clasifican en [`../foundation/sync-findings-register-2026-06-22.md`](../foundation/sync-findings-register-2026-06-22.md). Archivos está cerrado en código; migración remota, smoke y RLS siguen como `SYNC-017` a `SYNC-019`.

## Estado

- **Fecha de apertura:** 2026-06-08
- **Fuente:** `/Users/ernestomaxwell/Desktop/PLAN.md`
- **Estado general:** Slices 1-8 MVP implementados localmente; pendiente cerrar Slice 9 operativo, smoke multiusuario real y hardening Supabase/RLS/storage antes de declarar cierre robusto.
- **Prioridad:** Alta para Tesoreria, porque desbloquea asignaciones de facturas a tarjetas/cuentas sin duplicar gastos ni perder links pendientes entre maquinas.

## Resumen ejecutivo

El objetivo es registrar cuentas y tarjetas como medios de pago, asignar facturas de gasto a esos medios, conciliarlas contra movimientos bancarios cuando existan y ver reembolsos pendientes por usuario/tarjeta/ciclo. La implementacion debe ser local-first, sincronizable y segura: Tesoreria puede ver datos operativos no sensibles, pero no se guardan ni muestran numeros completos de cuentas o tarjetas.

La base critica es cambiar `transaction_links` para que su identidad de sync sea `id`, no `transaction_id`. Sin ese cambio, una asignacion pendiente con `transaction_id = null` puede perderse en pull/sync o deduplicarse mal. Por eso el roadmap empieza por schema/sync antes de UX.

## Decisiones cerradas

- Extender `bank_accounts`; no crear un catalogo paralelo.
- Extender `transaction_links`; no crear tabla nueva de allocations en v1.
- Usar `owner = 'user'` + `owner_user_id` para tarjetas personales, alineado con `invoice_extractions.linked_user_id`.
- Tesoreria ve todos los medios de pago, pero solo datos no sensibles: banco, tipo, owner, moneda, last4.
- `account_number_full` queda deprecado: no se usa ni se muestra; migrar a `NULL` y conservar columna por compatibilidad.
- Una tarjeta de credito activa requiere dia de corte y dia de vencimiento.
- Reminders entran en v1 solo en version ligera, mensual y auditable.

## Roadmap por slices

### Slice 1 — Schema y sync base

**Estado:** Implementado en codigo el 2026-06-08

**Objetivo:** Hacer que `transaction_links` soporte links pendientes sin `transaction_id`, que sincronice por `id` y que no duplique asignaciones.

**Backend/local:**
- Extender `bank_accounts` en SQLite y Supabase con owner, instrumento, last4, issuer, ciclo y reminder.
- Extender `transaction_links` con `transaction_id` nullable, `payment_instrument_id`, montos aplicados, moneda, FX, estado, ciclo y `updated_at`.
- Agregar `invoice_extraction` y `card_settlement` a los tipos permitidos de links.
- Cambiar UNIQUE local/remoto a dedupe por `workspace_id`, `linked_entity_type`, `linked_entity_id`, `COALESCE(transaction_id, '')`, `COALESCE(payment_instrument_id, '')`.
- Reconstruir tabla SQLite si hace falta para remover el UNIQUE viejo por `transaction_id + linked_entity_type + linked_entity_id`.

**Sync:**
- `localDatabase.ts`: materializar outbox de `transaction_link` por `id`.
- `localDatabase.ts`: tombstones siguen borrando por `id`.
- `financialDomainPullService.ts`: `transaction_links.entityIdColumn = 'id'`.
- `financialDomainPullService.ts`: validar existencia de `bank_transactions` solo cuando `transaction_id != null`.
- `treasuryMutationService.ts`: undo/outbox restore debe encolar con `link.id`.
- Compatibilidad transitoria: outbox viejo puede resolver por `transaction_id` si no encuentra link por `id`.

**Criterios de aceptacion:**
- Un link pendiente con `transaction_id = null` creado en maquina A aparece en maquina B despues de pull. **Cubierto por test local.**
- Doble asignacion de la misma factura al mismo medio no duplica por UNIQUE con `COALESCE`. **Cubierto por indice local y migracion Supabase.**
- Pull remoto de links repetidos no crea duplicados. **Cubierto por test local.**
- Links con `transaction_id` invalido se descartan solo cuando `transaction_id` no es null. **Cubierto por test local.**
- `account_number_full` no se reintroduce por upsert local ni pull remoto. **Cubierto por test local.**

**Archivos principales:**
- `apps/desktop/electron/main/services/data/treasuryFoundationBootstrap.ts`
- `apps/desktop/electron/main/services/data/financialDomainPullService.ts`
- `apps/desktop/electron/main/services/data/localDatabase.ts`
- `apps/desktop/electron/main/services/data/treasuryMutationService.ts`
- `supabase/migrations/20260608211102_treasury_payment_instruments_v4.sql`
- `apps/desktop/src/test/financial-domain-pull-service.test.ts`

### Slice 2 — Comandos idempotentes de Tesoreria

**Estado:** Implementado en backend/IPC el 2026-06-08

**Objetivo:** Agregar comandos seguros, idempotentes y auditables.

**Comandos:**
- `treasury.paymentInstrument.upsert` -> IPC `bukowskiTreasury:paymentInstrumentUpsert`
- `treasury.paymentInstrument.deactivate` -> IPC `bukowskiTreasury:paymentInstrumentDeactivate`
- `treasury.invoiceAllocation.assign` -> IPC `bukowskiTreasury:invoiceAllocationAssign`
- `treasury.invoiceAllocation.linkToTransaction` -> IPC `bukowskiTreasury:invoiceAllocationLinkToTransaction`
- `treasury.invoiceAllocation.unlink` -> IPC `bukowskiTreasury:invoiceAllocationUnlink`
- `treasury.invoiceAllocation.reject` -> IPC `bukowskiTreasury:invoiceAllocationReject`
- `treasury.invoiceAllocation.markReimbursed` -> IPC `bukowskiTreasury:invoiceAllocationMarkReimbursed`
- `treasury.cardSettlement.create` -> IPC `bukowskiTreasury:cardSettlementCreate`

**Reglas:**
- Todos idempotentes por `commandId`, con receipts y outbox.
- `paymentInstrument.upsert` reutiliza la ruta segura de cuentas, pero ahora valida metadata de medio de pago.
- Tarjeta de credito activa exige `statement_cycle_day` y `payment_due_day`.
- `owner = 'user'` exige `owner_user_id`.
- `cardSettlement.create` marca el movimiento de pago de tarjeta como `is_internal_transfer = 1`.
- La liquidacion de tarjeta solo cierra allocations del ciclo si `closeAllocations = true`.
- Suma de allocations no puede exceder total de factura cuando el documento local tiene total/moneda.
- Multimoneda exige `fx_rate`.
- `account_number_full` sigue sin persistirse.

**Archivos principales:**
- `packages/contracts/src/commands/treasury-commands.ts`
- `packages/contracts/src/validation/mutation-schemas.ts`
- `packages/contracts/src/ipc/channels.ts`
- `apps/desktop/electron/main/services/data/treasuryMutationService.ts`
- `apps/desktop/electron/main/ipc/registerFoundationIpc.ts`
- `apps/desktop/electron/preload/index.ts`
- `apps/desktop/src/vite-env.d.ts`
- `apps/desktop/src/test/treasury-mutation-service.test.ts`

### Slice 3 — Reminders ligeros

**Estado:** Implementado en backend local-first el 2026-06-08

**Objetivo:** Crear/actualizar reminders mensuales simples para tarjetas activas.

**Reglas:**
- Usar `reminders.recurrence_rule = 'FREQ=MONTHLY'`.
- Si `instrument_kind = 'credit_card'` y la tarjeta esta activa:
  - si tiene `owner_user_id`, usarlo como default;
  - si no tiene `owner_user_id`, exigir `reminder_user_id`.
- Crear/actualizar un reminder deterministico por tarjeta: `treasury-card-payment-${paymentInstrumentId}`.
- Si la tarjeta se desactiva o deja de ser `credit_card`, borrar el reminder deterministico.
- Encolar outbox de reminder con `sync-reminder-${reminderId}` para que delete reemplace upsert pendiente y no genere duplicados.
- No implementar calendario bancario movil avanzado en v1.

**Archivos principales:**
- `apps/desktop/electron/main/services/data/treasuryMutationService.ts`
- `apps/desktop/src/test/treasury-mutation-service.test.ts`

### Slice 4 — UX de medios de pago y asignaciones

**Estado:** MVP implementado en frontend el 2026-06-08

**Objetivo:** Darle a Tesoreria una UI usable para administrar medios y asignar facturas.

**Frontend:**
- Nueva vista **Cuentas y tarjetas** en Tesoreria. **Implementado.**
- Formulario compacto para crear/editar medios de pago, sin campos sensibles ni numero completo. **Implementado.**
- Bandeja de facturas agrega: Medio de pago y Estado conciliacion derivados de movimiento sugerido/aplicado. **Implementado parcial.**
- Seleccion multiple mantiene acciones existentes de usuario/proyecto/retry/download/dismiss. **Existente.**
- Asignacion batch directa a medio de pago, vincular sugerido y marcar reembolsado se completan en Slice 5 MVP.

### Slice 5 — Conciliacion asistida y Reembolsos

**Estado:** MVP implementado el 2026-06-08

**Objetivo:** Conciliar contra candidatos y visualizar deuda de reembolso.

**Frontend/backend:**
- Read model de Inbox trae allocation/link real por `invoice_extraction`. **Implementado.**
- Asignacion batch de facturas a medio de pago sin movimiento. **Implementado.**
- Accion para vincular el movimiento sugerido al allocation. **Implementado.**
- Accion para marcar allocation como reembolsado desde Inbox. **Implementado.**
- Vista **Reembolsos** derivada: agrupa por usuario/responsable x medio x ciclo desde filas visibles de Inbox. **Implementado MVP.**
- Drawer de conciliacion con candidatos rankeados por medio, monto, fecha, proveedor/RNC/descripcion y moneda. **Implementado en Slice 6.**
- Pendiente hardening: query dedicada para historico completo de reembolsos, no limitada al scope visible de Inbox.
- No crear `reimbursement_batches` formal en v1.

### Slice 6 — Hardening de conciliacion asistida

**Estado:** Implementado el 2026-06-08

**Objetivo:** Mejorar la seleccion manual de movimientos y corregir fricciones visuales del flujo de medios de pago.

**Frontend/backend:**
- Sub-nav interna de Tesoreria queda por encima del formulario de editar medio de pago. **Implementado.**
- Drawer de conciliacion asistida muestra candidatos rankeados por monto, fecha, medio de pago y texto proveedor/descripcion. **Implementado.**
- Elegir candidato crea allocation si falta y luego vincula el movimiento de forma idempotente. **Implementado.**
- El panel de crear/editar medio de pago se cierra automaticamente al salir de **Cuentas y tarjetas**. **Implementado en Slice 7.**

### Slice 7 — Reembolsos historicos y formulario contextual

**Estado:** MVP implementado el 2026-06-08

**Objetivo:** Quitar dependencia del scope visible de Inbox y reducir friccion del formulario de medios de pago.

**Frontend/backend:**
- Query dedicada `treasury.reimbursements` para consultar reembolsos por workspace, responsable, medio, ciclo y estado. **Implementado MVP.**
- El panel de reembolsos de Inbox ahora lee el historico desde SQLite local, no solo las filas visibles/filtradas. **Implementado MVP.**
- Formulario de medio de pago prioriza `Tipo` como primer campo. **Implementado.**
- Campos contextuales por tipo: cuenta bancaria, tarjeta debito, tarjeta credito, efectivo/otro muestran solo metadata relevante. **Implementado MVP.**
- Campos internos/confusos se reducen: `Nombre snapshot` deja de mostrarse; `Usuario reminder` queda como `ID para recordatorio` y solo aparece cuando una tarjeta de credito no tiene responsable. **Implementado MVP.**
- Sanitizacion antes de guardar limpia metadata que no aplica al tipo seleccionado. **Implementado.**
- Pendiente: filtros visibles por responsable/medio/ciclo/estado en la UI de reembolsos.
- Pendiente: tabla expandida con drill-down a facturas/movimientos y export CSV/XLSX.
- Pendiente: selector real de usuarios/responsables en vez de introducir IDs manuales.
- Pendiente: importadores de estados para bancos adicionales; hoy el modelo acepta `Otro`, pero los parsers automaticos solo cubren Banco Popular CSV y Banco Santa Cruz XLSX.

### Slice 8 — Filtros y drill-down de reembolsos

**Estado:** MVP implementado parcialmente el 2026-06-08

**Objetivo:** Convertir el panel de reembolsos en una herramienta operativa, no solo un resumen.

**Frontend/backend:**
- `TreasuryReimbursementGroup` incluye `items` con factura, proveedor, RNC, NCF, fecha, monto, estado y movimiento vinculado. **Implementado MVP.**
- Panel de reembolsos agrega filtros visibles por responsable, medio, estado y ciclo. **Implementado MVP.**
- Tarjetas de reembolso se expanden para ver facturas/movimientos dentro del grupo. **Implementado MVP.**
- Totales por moneda se muestran arriba del panel filtrado. **Implementado MVP.**
- Self-heal local agrega columnas fiscales antiguas de `invoice_extractions` si faltan en DBs viejas. **Implementado.**
- Pendiente: accion directa desde drill-down para abrir preview/editar factura.
- Pendiente: selector mejorado de responsables usando usuarios operativos reales, no solo crew/catalog IDs.
- Pendiente: export CSV/XLSX del resultado filtrado.
- Pendiente: soporte de import para bancos adicionales.

## Tests criticos

- Crear tarjeta activa sin corte/vencimiento falla.
- Crear tarjeta company/shared sin `owner_user_id` exige `reminder_user_id` si reminders activos.
- No se guarda ni expone `account_number_full`.
- Asignar factura a tarjeta sin movimiento crea link pendiente.
- Link pendiente sync A -> B sobrevive con `transaction_id = null`.
- Doble asignacion de la misma factura al mismo medio no duplica por UNIQUE con `COALESCE`.
- Vincular movimiento posterior cambia estado a `matched` o `partial`.
- Suma de allocations no puede exceder total de factura.
- Liquidacion de tarjeta no infla gastos porque el movimiento queda como transferencia interna.
- Multimoneda exige `fx_rate`.
- Permisos de Tesoreria/Finance bloquean lectura y escritura para usuarios no autorizados.

## Fuera de alcance v1

- Tabla formal de `reimbursement_batches`.
- Statements especializados de tarjetas con intereses, minimos o fees.
- Auto-conciliacion sin confirmacion humana.
- Guardar numeros completos de cuentas o tarjetas.
- Calendario bancario movil avanzado para fechas de corte/vencimiento.

## Bitacora

### 2026-06-08

- Se crea este documento vivo a partir del plan aprobado.
- Se confirma riesgo critico existente: `transaction_links` aun usa `transaction_id` como identidad de sync en algunos paths, lo que bloquea links pendientes con `transaction_id = null`.
- Primer slice seleccionado: schema/sync base antes de UX.
- Se implementa self-heal local idempotente para medios de pago y `transaction_links` v4:
  - agrega metadata no sensible de medio de pago en `bank_accounts`;
  - nulifica `account_number_full`;
  - reconstruye `transaction_links` para permitir `transaction_id = null`;
  - agrega dedupe unico por `COALESCE(transaction_id, '')` y `COALESCE(payment_instrument_id, '')`.
- Se crea migracion Supabase `20260608211102_treasury_payment_instruments_v4.sql`.
- Se cambia sync de `transaction_links` para usar `id` como identidad, con fallback transitorio para outbox viejo por `transaction_id`.
- Se ajusta la deteccion de transferencias internas para usar `last4`/masked en vez de numeros completos.
- Verificacion local:
  - `corepack pnpm --filter @bukowski/desktop test -- src/test/financial-domain-pull-service.test.ts src/test/treasury-mutation-service.test.ts` termino ejecutando la suite desktop completa: **287 passed, 2 skipped**.
  - `corepack pnpm --filter @bukowski/desktop typecheck`: **passed**.
- Se implementa Slice 2 backend/IPC:
  - comandos explicitos de payment instruments;
  - comandos de invoice allocations;
  - liquidacion de tarjeta como transferencia interna;
  - schemas IPC y preload renderer;
  - pruebas de tarjeta activa, no persistencia de numero completo, allocation pendiente, link posterior, limite por total y settlement.
- Verificacion Slice 2:
  - `corepack pnpm --filter @bukowski/desktop test -- src/test/treasury-mutation-service.test.ts`: **290 passed, 2 skipped**.
  - `corepack pnpm --filter @bukowski/desktop typecheck`: **passed**.
- Se implementa Slice 3 backend local-first:
  - tarjetas de credito activas crean/actualizan reminder mensual en SQLite;
  - tarjetas personales usan `owner_user_id` como usuario del reminder;
  - tarjetas shared/company sin usuario dueno exigen `reminder_user_id`;
  - desactivar tarjeta borra el reminder deterministico;
  - el outbox de reminders usa ID estable para que un delete reemplace un upsert pendiente.
- Verificacion Slice 3:
  - `corepack pnpm exec vitest run src/test/treasury-mutation-service.test.ts` desde `apps/desktop`: **21 passed**.
  - `corepack pnpm --filter @bukowski/desktop typecheck`: **passed**.
- Se implementa Slice 4 MVP frontend:
  - `BankAccountRow` expone metadata segura de medios de pago;
  - Tesoreria agrega tab **Cuentas y tarjetas**;
  - formulario de medio de pago elimina `account_number_full` de la UI;
  - acciones de editar/desactivar usan comandos idempotentes `paymentInstrumentUpsert` y `paymentInstrumentDeactivate`;
  - Bandeja de facturas muestra Medio de pago y Conciliacion usando movimiento sugerido/aplicado existente.
- Verificacion Slice 4:
  - `corepack pnpm --filter @bukowski/desktop typecheck`: **passed**.
- Se implementa Slice 5 MVP:
  - `InvoiceExtraction` expone `allocation` real desde `transaction_links`;
  - Inbox permite asignar facturas seleccionadas a medio de pago;
  - Inbox permite vincular el movimiento sugerido al allocation;
  - Inbox permite marcar allocations como reembolsadas;
  - se agrega panel visual de reembolsos pendientes agrupado por responsable, medio y ciclo;
  - se pule visualmente Cuentas y tarjetas: formulario con labels verticales, card premium, microjerarquia y estados mas claros.
- Verificacion Slice 5:
  - `corepack pnpm --filter @bukowski/desktop typecheck`: **passed**.
  - `corepack pnpm exec vitest run src/test/invoice-inbox-service.test.ts src/test/treasury-mutation-service.test.ts` desde `apps/desktop`: **28 passed**.
- Se implementa Slice 6 parcial:
  - se corrige el orden visual para que las tabs de Tesoreria queden sobre el formulario de editar medio de pago;
  - se agrega drawer de conciliacion asistida en Inbox;
  - los candidatos se rankean por monto cercano, fecha cercana, mismo medio y coincidencia de proveedor;
  - al seleccionar un candidato se crea allocation si hace falta y se vincula el movimiento con `commandId` deterministico.
- Verificacion Slice 6:
  - `corepack pnpm --filter @bukowski/desktop typecheck`: **passed**.
  - `corepack pnpm exec vitest run src/test/invoice-inbox-service.test.ts src/test/treasury-mutation-service.test.ts` desde `apps/desktop`: **28 passed**.
- Se implementa Slice 7 MVP parcial:
  - se agrega query local-first `treasury.reimbursements` con IPC/preload/hook renderer;
  - el panel de reembolsos de Inbox deja de depender de las filas visibles y consume el historico agrupado desde SQLite;
  - se corrige el bug donde el panel Nuevo/Editar medio de pago seguia visible al navegar a otra sub-seccion de Tesoreria;
  - el formulario de medio de pago pone `Tipo` primero y muestra/oculta campos segun cuenta, tarjeta, efectivo u otro;
  - se oculta `Nombre snapshot` y se renombra/acota `Usuario reminder` para reducir carga cognitiva;
  - se sanitizan campos no aplicables antes de persistir cambios.
- Verificacion Slice 7 MVP parcial:
  - `corepack pnpm --dir apps/desktop exec vitest run src/test/treasury-mutation-service.test.ts`: **21 passed**.
  - `corepack pnpm --filter @bukowski/desktop typecheck`: **passed**.
  - Nota: un intento previo con `corepack pnpm --filter @bukowski/desktop test -- src/test/treasury-mutation-service.test.ts` ejecuto gran parte de la suite desktop y fallo solo por un test local mal invocado; luego se corrigio el test y el spec focalizado paso.
- Se implementa Slice 8 MVP parcial:
  - grupos de reembolso ahora incluyen detalle `items` por factura;
  - el panel agrega filtros por responsable, medio, estado y ciclo;
  - se agregan totales por moneda y tarjetas expandibles con proveedor, NCF, fecha, monto y movimiento vinculado;
  - `invoice_extractions` suma self-heal para columnas fiscales si una DB local antigua no las tiene.
- Verificacion Slice 8 MVP parcial:
  - `corepack pnpm --filter @bukowski/desktop typecheck`: **passed**.
  - `corepack pnpm --dir apps/desktop exec vitest run src/test/treasury-mutation-service.test.ts`: **21 passed**.
- Se implementa polish posterior a Slice 8:
  - selector batch de Facturas queda organizado por grupos logicos, con acciones coherentes con menu contextual;
  - tabla de Facturas usa altura estable/fill parent para evitar crecimiento al cambiar de seccion;
  - drawer de conciliacion asistida queda centrado, mas compacto y con scroll interno;
  - medio de pago en Facturas muestra terminal `last4` en bold/ambar cuando existe;
  - Cuentas y tarjetas usa iconos por tipo, grilla estable, terminal solo en header, tipo de cuenta en vez de movimiento para cuentas bancarias y sin microcard de movimientos en tarjetas;
  - formulario de medios acepta bancos custom, usuarios responsables por selector y terminal de tarjetas como `last4` seguro;
  - servicio de Tesoreria persiste `last4` enviado por UI sin guardar numeros completos y lo cubre con test de regresion;
  - loading gate de workspace cubre todo el viewport para no filtrar contenido interno del app en bordes de Electron/macOS.
- Verificacion polish posterior:
  - `npm run typecheck` desde `apps/desktop`: **passed**.
  - `npm run test -- treasury-mutation-service.test.ts` desde `apps/desktop`: **21 passed**.
- Se implementa Slice 9 parcial:
  - drill-down de reembolsos agrega acciones directas para preview de factura, editar factura y saltar al movimiento vinculado;
  - saltar al movimiento cambia a tab **Movimientos**, limpia filtros que podrian ocultar la fila, selecciona la transaccion y hace auto-scroll;
  - reembolsos filtrados exportan CSV y XLSX desde el renderer, en formato plano por factura/allocation;
  - filtro de responsables de reembolsos incluye tanto catalogo local como responsables reales retornados por la query, evitando depender de IDs manuales;
  - labels de responsable/reminder dejan de exponer "ID" al usuario.
- Verificacion Slice 9 parcial:
  - `npm run typecheck` desde `apps/desktop`: **passed**.

## Proximo slice recomendado

**Slice 10 — smoke multiusuario y cierre MVP.**

Orden sugerido:
1. Smoke multiusuario real: Facturas, Cuentas, Movimientos y Reembolsos entre dos Macs/usuarios.
2. Confirmar que la migracion Supabase `20260608211102_treasury_payment_instruments_v4.sql` esta aplicada en remoto y no hay drift.
3. Revisar `sync_outbox`, pull cursors y errores visibles despues del smoke.
4. Hardening Supabase/RLS/storage: confirmar grants, policies y disponibilidad real de PDFs/adjuntos.
5. Diseñar soporte para bancos adicionales: primero metadata `Otro/custom`, luego parser generico CSV/manual y despues parsers dedicados por banco.
6. Dejar auto-conciliacion sin confirmacion humana fuera de v1.
