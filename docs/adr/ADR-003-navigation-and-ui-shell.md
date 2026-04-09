# ADR-003: Navigation and UI Shell Structure

Status: Accepted

## Context

Bukowski necesita convivir con AssetOps y FinanceOps sin caer en un dashboard inflado ni en una app de dos tabs demasiado simple.

## Decision

- Usar un sidebar global persistente.
- Mantener un top context bar para workspace, proyecto activo, filtros, busqueda y quick actions.
- Mostrar subnavegacion contextual segun el dominio activo.
- Hacer visible FinanceOps desde v1 como shell real con vistas utiles y hooks estructurales.
- Priorizar patrones list/detail, timelines y queues operativas sobre mosaicos de widgets.

## Why

- Escala mejor con modulos nuevos.
- Mantiene project awareness sin esconder vistas globales.
- Hace que FinanceOps exista estructuralmente sin robar foco al MVP de AssetOps.
- Refuerza una UX sobria, operativa y premium.

## Consequences

- El shell debe resolver bien estados globales vs contexto de proyecto.
- Las vistas de lista y detalle se vuelven patron central del producto.
- El dashboard debe ser contenido y util, no decorativo.
