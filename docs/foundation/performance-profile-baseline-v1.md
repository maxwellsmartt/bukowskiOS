# BukowskiOS — Performance profile baseline v1

## Objetivo
Tener una forma repetible de medir superficies pesadas del app sobre un dataset local más cercano a uso real, sin depender de percepción manual.

## Dataset pesado
- Se activa con `BUKOWSKI_PROFILE_DATASET=1`
- El runtime local agrega datos sintéticos e idempotentes para estresar:
  - `Timeline` con muchos proyectos y unidades
  - `Mission Control` con más runs y actividad
  - `Global Search` con más entidades visibles
  - `Assistant Chat` con threads y mensajes largos
  - `Finance`, `Incidents` y `Packing` con colas más amplias

## Cómo correrlo
```bash
corepack pnpm --filter @bukowski/desktop test:e2e:perf
```

## Qué mide hoy
- `boot-heavy-dataset`
- `mission-control-heavy-dataset`
- `sync-outbox-heavy-dataset`
- `global-search-heavy-dataset`
- `timeline-overview-heavy-dataset`
- `assistant-chat-heavy-dataset`

## Budget inicial
- Boot: `< 12s`
- Mission Control: `< 5s`
- Sync outbox: `< 4s`
- Global Search: `< 4s`
- Timeline Overview: `< 5s`
- Assistant Chat: `< 4s`

Estos budgets son pragmáticos para alpha interna y deben endurecerse cuando tengamos:
- una Mac arm64 limpia dedicada para baseline
- más repeticiones del test
- menos variabilidad de entorno

## Decisiones de este slice
- Se añadió `useVisiblePolling` para reducir trabajo cuando la app está en background.
- `GlobalSearchPalette` dejó de recalcular índices con búsqueda `O(n²)` al pintar grupos grandes.
- El dataset pesado es opcional y no toca el flujo normal del app.

## Riesgos remanentes
- `medio`: esto es un baseline local, no profiling de CPU/memoria a nivel de flamegraph.
- `medio`: los thresholds siguen siendo amplios para evitar flakiness en alpha interna.
- `bajo`: el dataset sintético no reproduce todos los patrones reales de uso, pero sí da presión suficiente para detectar regresiones visibles.
