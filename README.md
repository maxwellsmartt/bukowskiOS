# bukowskiOS

Sistema operativo interno para Metadata Cine enfocado en InventoryOps / AssetOps, con base event-driven, desktop-first y preparado para crecer hacia FinanceOps, sync multi-device y agentes.

## Estado actual

Este repo ya incluye el foundation pack aprobado para arrancar la implementación:

- estructura de repo modular
- shell desktop inicial
- ADRs fundacionales
- propuesta de schema v1
- guía de navegación y densidad UI
- `AGENT.md` operativo para Codex

Además, el branch actual ya incluye el primer batch `admin foundation`:

- catálogo global real para `locations`, `departments`, `crew`, `clients`, `kits` y `categories`
- edición, creación y archivado real de assets
- `projects.client_id` con compatibilidad temporal con `client_name`
- `scannable_codes` como base futura para QR y barcode
- servicios base para generación de QR, barcode y PDFs

## Stack base

- Electron
- React
- TypeScript
- Vite
- SQLite local operativa
- Supabase como backbone cloud

## Filosofía del producto

- `events first`
- proyecciones rápidas para estado actual
- desktop-first con diseño dark-only
- modularidad estricta
- trazabilidad auditable
- superficie preparada para FinanceOps, móvil, sync y agentes

## Estructura principal

```text
apps/desktop        Shell Electron + renderer React
packages/contracts  Contratos tipados de commands, queries e IPC
packages/domain     Tipos y reglas del dominio
packages/db         Migraciones, SQLite y proyecciones
packages/sync       Outbox y transporte futuro
packages/ui         Tokens y primitives del sistema visual
docs/adr            Decisiones arquitectónicas
docs/foundation     Mapas y guías del foundation pack
supabase            Backbone cloud y storage
```

## Comandos base

```bash
pnpm dev
pnpm build
pnpm test
pnpm typecheck
```

## Documentos clave

- [AGENT.md](./AGENT.md)
- [ADR-001](./docs/adr/ADR-001-stack-and-desktop-architecture.md)
- [ADR-002](./docs/adr/ADR-002-events-and-projections.md)
- [ADR-003](./docs/adr/ADR-003-navigation-and-ui-shell.md)
- [Schema v1](./docs/foundation/schema-v1.md)
- [Navigation shell v1](./docs/foundation/navigation-shell-v1.md)
- [UI density v1](./docs/foundation/ui-density-v1.md)
- [Local dev guide](./docs/foundation/local-dev-guide.md)
- [Next slices v1](./docs/foundation/next-slices-v1.md)

## Notas

- FinanceOps aparece desde el día uno como shell estructural real, pero no incluye todavía flujos contables completos.
- El shell actual ya soporta lectura/escritura real para proyectos, assets, incidentes, packing slips y master data global, pero todavía falta hardening local y bridge cloud.
- Para levantar y validar el shell actual, seguir [docs/foundation/local-dev-guide.md](./docs/foundation/local-dev-guide.md).
