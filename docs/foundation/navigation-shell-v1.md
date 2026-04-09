# Navigation Shell v1

## Primary nav

- `Overview`
- `AssetsOps`
- `FinanceOps`

## AssetsOps subnav

- `Assets`
- `Packing Slips`
- `Incidents`
- `Projects`
- `Catalog`

## FinanceOps subnav

- `Overview`
- `Cost Links`
- `Entries`

## Utility nav

- `Reports` en estado interno u oculto hasta tener exportes reales
- `Admin`
- `Settings`

## Top context bar

- `Workspace switcher`
- `Project scope selector`
- `Global search / command bar`
- `Active filters summary`
- `Primary quick action`
- `Sync / upload health`
- `Current user menu`

## Comportamiento

- El proyecto activo filtra y da contexto, pero no secuestra toda la app.
- `Assets` e `Incidents` necesitan poder verse globales o scoped por proyecto.
- `FinanceOps` hereda el mismo `project scope selector` para ensenar su vinculo con AssetOps.
