# BukowskiOS — Sync roadmap v1

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
- Pendiente: catálogos fundacionales completos y estrategia explícita de deletes/tombstones para dominios donde no convenga hard delete.

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
Estado: **In progress**

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
Estado: **In progress**

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
Estado: **In progress**

Objetivo:
- aceptar cambios remotos de vuelta

Estado actual:
- Catalog/asset pull usa cursor local y LWW.
- Operational snapshots usa snapshots por entidad (`project`, `packing_slip`, `incident`, `rma_case`) y apply idempotente.
- Falta smoke multiusuario real y UI de recuperación más clara cuando queden dependencias remotas faltantes.

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
- `DEFAULT_WORKSPACE_ID` ya centralizado en código vivo
- retention básica para no dejar crecer indefinidamente `sent` outbox y telemetría auxiliar
- hardening de packaging y recovery ya resueltos
- hardening de startup local: la ventana de carga aparece antes de la inicialización SQLite y el bootstrap del project wizard ya tolera workspace demo ausente/referencias opcionales huérfanas

## Riesgos abiertos
- `crítico`: falta smoke multiusuario con build empaquetado actualizado para confirmar que projects/packing/incidents/RMAs viajan entre máquinas
- `crítico`: falta validar el nuevo DMG en la Mac de Carlos; el log anterior fallaba en `apply project creation wizard migration` por FK antes de cargar renderer
- `medio`: todavía no existe identidad real multi-workspace completa para todos los dominios, aunque Auth/Workspace y guards principales ya están activos
- `medio`: `foundationSeed` sigue sembrando el workspace demo fijo
- `medio`: Agents aún arrastra deuda de workspace activo / `DEFAULT_WORKSPACE_ID`
- `bajo`: `packages/sync` sigue siendo más transport/boundary que engine completo de reconciliación
