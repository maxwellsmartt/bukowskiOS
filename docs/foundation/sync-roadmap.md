# BukowskiOS — Sync roadmap v1

## Estado actual
- BukowskiOS es **local-first**
- el contrato local ya existe vía `sync_outbox`
- `packages/sync` ya define los límites mínimos:
  - `outbox/types.ts`
  - `mappers/index.ts`
  - `transport/index.ts`
- hoy no existe un worker real que procese el outbox ni una integración remota activa

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

## Qué no debemos hacer todavía
- no abrir sync real antes de estabilizar identidad de workspace
- no mezclar transporte remoto con lógica de dominio
- no introducir merge/conflict logic compleja antes de tener casos reales

## Fases recomendadas

### Fase 1 — Outbox worker local
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
Objetivo:
- aceptar cambios remotos de vuelta

No abrir antes de tener:
- versionado por entidad
- estrategia clara de conflicto
- reglas de precedencia documentadas

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

## Riesgos abiertos
- `medio`: todavía no existe identidad real multi-workspace, solo preparación
- `medio`: `foundationSeed` sigue sembrando el workspace demo fijo
- `medio`: falta decidir backend remoto real y modelo de auth
- `bajo`: `packages/sync` todavía es un boundary package, no un engine real
