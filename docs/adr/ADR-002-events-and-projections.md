# ADR-002: Events and Projections

Status: Accepted

## Context

Bukowski necesita responder que paso, quien lo hizo, donde ocurrio y cual es el estado actual sin depender de memoria o chats informales.

## Decision

- El historial operativo vive en tablas append-only de eventos, con `asset_events` como fuente historica principal.
- El estado actual vive en proyecciones optimizadas como `asset_current_state`.
- Cada command write debe, dentro de la misma transaccion local:
  - validar reglas de dominio
  - escribir evento
  - actualizar proyeccion
  - encolar outbox si aplica
- Las correcciones se modelan con eventos compensatorios, no reescribiendo pasado.
- `asset_assignments`, `packing_slips` e `incidents` son agregados operativos enlazados al event log, no sustitutos del mismo.

## Why

- Da auditabilidad, trazabilidad y base futura para reporting, agentes, mensajeria y linkage financiero.
- Evita que el estado actual tape la secuencia real de hechos.
- Permite UI rapida sin hacer event-sourcing extremo en cada vista.

## Consequences

- Hace falta testear invariantes entre eventos y proyecciones.
- Hay que disenar taxonomia de eventos y versionado con cuidado.
- Debuggear requiere mirar evento, proyeccion y outbox, no una sola tabla.
