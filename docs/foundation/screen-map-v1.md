# Screen Map v1

| Pantalla | Ruta | Layout base | Proposito |
| --- | --- | --- | --- |
| Overview | `/overview` | KPI strip + queues + movimientos recientes | Responder que esta pasando ahora |
| Assets List | `/assets` | filter bar + table + preview pane opcional | Buscar y operar assets rapido |
| Asset Detail | `/assets/:assetId` | header + summary + tabs + action rail | Ficha viva del asset |
| New / Edit Asset | `/assets/new` | form panel + metadata groups | Alta y edicion controlada |
| Packing Slips | `/packing-slips` | table + status filters | Ver slips activos, vencidos y cerrados |
| Packing Slip Detail | `/packing-slips/:id` | document header + items table + return actions | Emitir y cerrar salidas y retornos |
| New Packing Slip | `/packing-slips/new` | guided builder | Crear slip por proyecto o departamento |
| Incidents | `/incidents` | table + severity/status filters | Vista supervisor-friendly |
| Report Incident | `/incidents/new` | short form + upload | Reporte rapido de campo |
| Incident Detail | `/incidents/:id` | incident header + evidence + linked context | Seguimiento operativo |
| Projects | `/projects` | list + status cards | Contexto de proyectos activos |
| Catalog | `/catalog` | tabs internas | Locations, Departments, Categories |
| Finance Overview | `/finance` | KPI + exposure + linked queues | Shell real de FinanceOps |
| Finance Cost Links | `/finance/cost-links` | linked table | Incidentes y assets con impacto economico |
| Finance Entries | `/finance/entries` | register shell | Base del ledger futuro |
| Admin / Settings | `/settings` | sections | Roles, permisos, workspace, app prefs |
