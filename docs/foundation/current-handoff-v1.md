# Current Handoff v1

Documento de continuidad para retomar bukowskiOS en otro thread sin perder contexto operativo, tecnico ni de producto.

Ultima actualizacion:
- fecha: `2026-04-10`
- branch de trabajo principal: `codex/timeline-ux-refinement-v1`
- commit mas reciente en este branch: `0214767` (`fix: stabilize overview timeline interactions`)

## 1. Que es bukowskiOS ahora

bukowskiOS ya no esta en etapa de foundation vacia. Hoy es una app desktop local-first para operar:

- assets
- projects
- packing slips
- incidents
- finance shell
- catalog global del workspace
- scheduling de proyectos y units
- compare tray foundation

La filosofia de producto cerrada hasta ahora es:

- `Workspace = compania`
- `Global = data transversal del workspace`
- `Project = contexto operativo especifico de un proyecto`
- `Finance = superficie global del workspace`
- `Budget = superficie financiera especifica del proyecto`

Tambien ya esta cerrada esta semantica:

- desde `Global` se asignan recursos a proyectos
- dentro de `Project` se operan y supervisan los recursos ya asignados
- `Projects` no es un filtro global implicito; es un modo propio con rutas propias

## 2. Estado actual del producto

### Ya existe y funciona

- shell desktop Electron + React estable
- SQLite local real
- migraciones y seed demo local
- CRUD real de:
  - assets
  - projects
  - catalog global
  - incidents
  - packing slips
- scope `Global vs Project` separado
- scheduling base con:
  - fechas de proyecto
  - color por proyecto
  - `project_units`
  - timeline global en `Overview`
- compare tray foundation persistida localmente
- sorting query-driven
- local search por vista
- global search estilo command palette
- hardening local inicial en writes y conflictos operativos

### Lo que aun NO esta cerrado

- auth real
- cloud sync real
- Supabase bridge productivo
- compare surface final
- PDFs operativos finales
- scanner movil
- mobile bridge
- sync hardening real

## 3. Branches y batches importantes ya realizados

### `codex/bukowski-foundation-planning-v1`

Bloques importantes ya implementados ahi:

- `97841e6` `feat: separate global and project scopes`
- `5b2120d` `fix: polish shell scope and sqlite fallback`
- `6532d38` `fix: stabilize sidebar utility and internal scroll`
- `1c974ab` `feat: add scheduling and compare foundation`
- `8c2f768` `fix: harden local operational conflicts`

Este branch representa el foundation operacional fuerte del producto.

### `codex/ux-search-sort-copy-refinement-v1`

Batch de refinamiento transversal:

- `aed49da` `feat: refine ux search sorting and dev flow`

Incluye:

- sorting tipado y persistido por vista
- local search por vista
- command palette global
- copy cleanup
- mejor flujo de refresh en dev

### `codex/timeline-ux-refinement-v1`

Branch actual de trabajo.

Commits importantes:

- `eb0cf54` `feat: refine overview timeline ux`
- `0214767` `fix: stabilize overview timeline interactions`

Este branch concentra el refinamiento del timeline global de `Overview`.

## 4. Decisiones de arquitectura y UX ya cerradas

### Scope y navegacion

- `Overview`, `Assets`, `Finance` son superficies globales del workspace
- `Packing Slips`, `Incidents`, `Projects` y `Catalog` pertenecen visualmente al dominio operativo global
- `Project Overview`, `Project Assets`, `Project Packing`, `Project Incidents`, `Project Budget`, `Project Info` son superficies project-scoped
- la ruta activa manda el scope, no `activeProject` como filtro implicito

### Domain model

- `crew_members` vive separado de `users`
- `crew_members.linked_user_id` puede enlazar un user interno cuando haga falta
- `clients` es catalogo global real
- `kits` es entidad global real
- `project_units` es entidad propia de cada proyecto
- `project_unit_id` en proyecciones operativas existe como redundancia util de lectura, no como verdad canonica

### Scheduling

- `projects.start_date` / `projects.end_date` son fechas oficiales del proyecto
- `projects.color_key` usa paleta curada, no hex libres
- `project_units` tiene `sort_order`
- `project_units.status` usa modelo `derived-with-explicit-cancel-override`
- `wrapped` no es override libre; llega por accion guiada que ajusta fecha

### Compare

- compare tray puede guardar mezcla de tipos
- compare real solo sera por grupos compatibles
- v1 compatible:
  - `asset` con `asset`
  - `project` con `project`
  - `financial_entry` con `financial_entry`

## 5. Estado actual del timeline global

El timeline de `Global > Overview` ya tiene:

- projects como lanes principales
- units como sub-lanes expandibles
- controles de:
  - `Day / Week / Month`
  - `30D / 90D / 6M`
  - `Today`
  - step left / right por ventana
- playhead visible
- pan horizontal
- persistencia local de:
  - `range`
  - `scale`
  - `anchorDate`
  - proyectos expandidos

### Fix importante ya aplicado

El timeline estaba teniendo un problema de UX fuerte:

- al arrastrar, parecia que el timeline se recargaba o desaparecia por momentos

La causa real era una mezcla de:

- cambio de `anchorDate` persistido demasiado agresivamente
- dependencia de render/refetch mientras se arrastraba
- playhead dibujado por segmento en vez de como overlay unico

La solucion aplicada en `0214767` fue:

- `useOverviewTimeline()` deja de refetchear por cada cambio de interaccion
- el renderer resuelve localmente la ventana visible durante el pan
- el `anchorDate` se confirma al soltar, no en cada pixel
- el playhead ahora vive como una capa compartida por encima de todas las lanes
- `Day` ya no se alinea internamente a semana en el read model

### Riesgo residual real del timeline

Impacto: `bajo`

Queda por afinar visualmente en revisiones manuales:

- spacing fino
- densidad de labels
- sensacion de precision visual
- controles mas discretos si aun se sienten pesados

No hay ahora mismo un blocker tecnico conocido en el timeline.

## 6. Archivos clave para continuar

### Shell, scope y rutas

- `apps/desktop/src/app/providers/ShellContext.tsx`
- `apps/desktop/src/app/shell/AppShell.tsx`
- `apps/desktop/src/app/shell/ShellSidebar.tsx`
- `apps/desktop/src/app/routing/routes.tsx`
- `apps/desktop/src/app/routing/route-meta.ts`

### Timeline y overview

- `apps/desktop/src/features/overview/OverviewPage.tsx`
- `apps/desktop/src/features/overview/OverviewScheduleTimeline.tsx`
- `apps/desktop/src/features/overview/useOverviewSnapshot.ts`
- `apps/desktop/src/shared/styles/global.css`
- `apps/desktop/electron/main/services/data/foundationReadService.ts`
- `packages/contracts/src/queries/overview-queries.ts`

### Projects y units

- `apps/desktop/src/features/projects/ProjectOverviewPage.tsx`
- `apps/desktop/src/features/projects/ProjectInfoPage.tsx`
- `apps/desktop/src/features/projects/ProjectUnitsManager.tsx`
- `apps/desktop/electron/main/services/data/projectMutationService.ts`
- `apps/desktop/electron/main/services/data/projectScheduling.ts`

### Search, sorting y compare foundation

- `apps/desktop/src/shared/hooks/useListControls.ts`
- `apps/desktop/src/shared/components/ListToolbar.tsx`
- `apps/desktop/src/shared/components/DataTable.tsx`
- `apps/desktop/src/app/shell/GlobalSearchPalette.tsx`
- `apps/desktop/src/app/providers/CompareTrayContext.tsx`
- `apps/desktop/src/app/shell/CompareTrayBar.tsx`

### Main local data / mutation layer

- `apps/desktop/electron/main/services/data/foundationReadService.ts`
- `apps/desktop/electron/main/services/data/assetMutationService.ts`
- `apps/desktop/electron/main/services/data/incidentMutationService.ts`
- `apps/desktop/electron/main/services/data/packingMutationService.ts`
- `apps/desktop/electron/main/services/data/catalogMutationService.ts`

## 7. Tests importantes ya existentes

Los tests mas utiles para continuar sin romper base actual:

- `apps/desktop/src/test/foundation-read-service.test.ts`
- `apps/desktop/src/test/asset-mutation-service.test.ts`
- `apps/desktop/src/test/incident-mutation-service.test.ts`
- `apps/desktop/src/test/packing-mutation-service.test.ts`
- `apps/desktop/src/test/project-mutation-service.test.ts`
- `apps/desktop/src/test/catalog-mutation-service.test.ts`
- `apps/desktop/src/test/navigation.test.ts`

Comando de seguridad antes de cerrar cualquier batch:

```bash
corepack pnpm verify
```

## 8. Flujo local y troubleshooting real

### Comandos base

```bash
corepack pnpm dev
corepack pnpm verify
```

### Estado del runtime local

- el proyecto corre con SQLite local
- `dev` usa Electron + Vite
- ya existe mejora de refresh en dev, pero HMR todavia puede dejar bundles viejos si una cadena de cambios rompe una vista a mitad de reload

### Si aparece fallback rojo/negro de shell runtime

Primero asumir esto:

- puede ser un runtime viejo de HMR, no necesariamente codigo roto actual

Acciones recomendadas:

1. pulsar `Reload workspace`
2. si persiste, reiniciar `corepack pnpm dev`
3. revisar terminal antes de asumir regression estructural

### Nota importante sobre timeline y HMR

Hubo un caso concreto donde el bundle en runtime seguia apuntando a una referencia vieja:

- `renderedPlayheadLeft is not defined`

El source actual ya no tenia ese bug; el problema era HMR stale state. Tenerlo presente antes de perseguir fantasmas.

## 9. Principales riesgos abiertos

### Medio

- `compare surface real` todavia no existe; solo esta la tray y la base tipada
- `cloud/auth/sync` todavia no comenzo como foundation productiva
- timeline todavia puede necesitar una pasada de QA visual fina dentro de Electron real

### Bajo

- algun ajuste menor de copy, spacing o densidad puede seguir apareciendo al revisar pantallas en vivo
- controles del timeline pueden refinarse aun mas si se busca una sensacion todavia mas premium

## 10. Orden recomendado de lo siguiente

### Si la prioridad sigue siendo pulido de producto local antes de cloud

Orden sugerido:

1. terminar QA visual fina del timeline
2. hacer `compare surface real`
3. pulir comparaciones base entre assets / projects / financial entries
4. revisar si falta otro pase corto de UX consistency

### Si la prioridad vuelve a roadmap estructural

Orden sugerido:

1. `Supabase/Auth/Cloud foundation`
2. `Sync / Outbox hardening real`
3. `QR / PDF / documents productivos`
4. `Mobile / scanner bridge`

## 11. Guardrails para el siguiente thread

- no meter negocio nuevo en batches de UX si lo que hace falta es estabilidad o legibilidad
- no volver a acoplar `Project` como filtro implicito de vistas globales
- no mover sorting/search al renderer como logica ad-hoc; mantenerlo query-driven
- no redisenar compare tray antes de construir la compare surface encima de la base actual
- en timeline:
  - preferir precision estructural sobre efectos visuales
  - el playhead debe seguir siendo overlay unico
  - evitar cualquier interaccion que se sienta como reload o flicker

## 12. Objetivo de producto que ya esta emergiendo

bukowskiOS ya no es solo inventario.

La capa que se esta construyendo es:

- recursos
- tiempo
- contexto operativo

Eso significa que las superficies mas valiosas del producto no son solo listas de items, sino vistas que ayudan a decidir:

- que corre en paralelo
- que recursos estan comprometidos
- que tension operativa existe
- que impacto financiero puede venir

El siguiente trabajo deberia proteger esa direccion, no diluirla.
