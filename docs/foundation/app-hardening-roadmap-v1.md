# BukowskiOS — Roadmap de hardening y shippability v1

## Resumen ejecutivo
- Meta inmediata: **internal alpha sólido**
- Regla operativa: **no abrir más de 2 frentes grandes a la vez**
- Frentes activos:
  - **Frente A**: seguridad, integridad de datos y packaging base
  - **Frente B**: copy crítico y Settings mínima, después de cerrar el hardening urgente

## Already Covered / Partial
- Threads durables, adjuntos persistentes y recuperación básica del chat
- Aprobaciones supervisadas y aprobación por sesión
- Runtime diagnostics iniciales para errores de `main`, `renderer` y `webContents`
- Tooling más útil para `Bugs Agent`

## Siguiente fase — Alpha Hardening Operativo

### Slice A1 — Smoke y E2E críticos
- Estado: `done`
- Objetivo:
  - detectar regresiones visibles de arranque, navegación y pantallas críticas antes de seguir ampliando features
- Área:
  - frontend / infra
- Alcance inicial:
  - Playwright para Electron sobre el build real
  - smoke de shell bootstrap
  - smoke de `Mission Control`, `Runs` y `Settings`
  - checklist manual de alpha interna
- Qué se probó:
  - `corepack pnpm --filter @bukowski/desktop test:e2e`
  - arranque real de Electron sobre build compilado
  - navegación a `Mission Control`, `Runs` y `Settings`
- Evidencia:
  - harness E2E de Playwright para Electron añadido
  - helper con `HOME` temporal y bypass controlado de single-instance para runs de test
  - checklist manual de smoke para alpha interna documentado
- Riesgos remanentes:
  - `medio`: todavía no cubre flujos largos de operación ni approvals end-to-end completos
  - `medio`: sigue faltando smoke manual del build empaquetado en Mac arm64 limpia

### Slice A2 — Bundle y performance hardening
- Estado: `done`
- Objetivo:
  - bajar el peso inicial del renderer y eliminar warnings de bundle grande sin reescribir la app
- Área:
  - frontend / infra
- Alcance inicial:
  - lazy-loading por rutas
  - chunking básico de vendors
  - validación E2E después del split
- Qué se probó:
  - `corepack pnpm --filter @bukowski/desktop typecheck`
  - `corepack pnpm --filter @bukowski/desktop test`
  - `corepack pnpm --filter @bukowski/desktop build`
  - `corepack pnpm run test:e2e` desde `apps/desktop`
- Evidencia:
  - `AppRoutes` ahora carga páginas pesadas con `React.lazy`
  - `AppShell` renderiza fallback controlado durante transiciones de ruta
  - el build dejó de emitir el warning de chunk > `500 kB`
  - el bundle inicial del renderer bajó desde ~`560 kB` minificados en un solo chunk a una base repartida entre `index`, `vendor`, `react-vendor` y chunks por página
  - se corrigió además una colisión real de IDs en `agent_activity_events` descubierta durante la validación
- Riesgos remanentes:
  - `medio`: todavía no hay profiling fino de runtime en vistas muy pesadas como timeline o Mission Control con datasets grandes
  - `medio`: el bundle de `main` (`dist-electron/app.js`) sigue siendo grande, aunque eso no impacta igual que el renderer en UX percibida

### Slice A3 — Sync worker local para outbox
- Estado: `done`
- Objetivo:
  - activar `sync_outbox` como cola local real, con retries y estado visible, sin depender todavía de un backend remoto
- Área:
  - backend / frontend
- Alcance inicial:
  - worker local para `pending -> processing -> sent/failed`
  - recuperación de rows atascadas en `processing`
  - backoff exponencial simple
  - acción manual desde `Settings`
  - métricas visibles en diagnóstico local
- Qué se probó:
  - `corepack pnpm --filter @bukowski/desktop typecheck`
  - `corepack pnpm --filter @bukowski/desktop test`
  - `corepack pnpm --filter @bukowski/desktop build`
- Evidencia:
  - nuevo `syncOutboxWorkerService` local y auditable
  - integración en startup y timer periódico del runtime local
  - `Settings` ahora muestra último sync local, estado del worker y counts de `pending/processing/failed`
  - botón `Run local sync now` para debug rápido sin tocar la base directamente
- Riesgos remanentes:
  - `medio`: este worker solo reconoce rows localmente; no existe todavía transporte remoto ni reconciliación con servidor
  - `medio`: el `shell` principal todavía muestra `Local-first` y no refleja counts del outbox en tiempo real
  - `bajo`: si más adelante añadimos varios workers o procesos, habrá que endurecer más la lógica de claim para concurrencia real multi-proceso

### Slice A4 — Surface operacional del sync
- Estado: `done`
- Objetivo:
  - hacer visible y debugeable el estado del outbox sin obligar al usuario a inspeccionar la base de datos o depender solo de logs
- Área:
  - frontend / backend
- Alcance inicial:
  - señal rápida del sync en la top bar
  - detalle de filas del outbox en `Settings`
  - retry manual por fila
- Qué se probó:
  - `corepack pnpm --filter @bukowski/desktop typecheck`
  - `corepack pnpm --filter @bukowski/desktop test`
  - `corepack pnpm --filter @bukowski/desktop build`
  - `corepack pnpm run test:e2e` desde `apps/desktop`
- Evidencia:
  - el icono de sync en la shell ahora refleja estado `healthy/active/failed` con badge de cola
  - existe una vista dedicada en `/settings/sync` con filtros por estado, retry por fila, retry masivo y detalle de payload
  - `Settings` quedó como resumen y punto de entrada a la cola local
  - existe retry manual por fila y `retry all failed` sin tocar SQL a mano
- Riesgos remanentes:
  - `medio`: la top bar refresca por polling simple, no por eventos en tiempo real
  - `medio`: todavía no hay acciones masivas más finas como retry por tipo de entidad o purge selectivo

### Slice A5 — Runtime polling y performance hardening fino
- Estado: `done`
- Objetivo:
  - bajar trabajo innecesario cuando la app está en background y reducir refreshes agresivos en superficies pesadas sin rehacer arquitectura
- Área:
  - frontend
- Alcance inicial:
  - polling visible-aware para superficies con refresh periódico
  - limitar recargas cuando la ventana no está enfocada o no está visible
  - mantener la UI viva cuando vuelve al frente
- Qué se probó:
  - `corepack pnpm --filter @bukowski/desktop typecheck`
  - `corepack pnpm --filter @bukowski/desktop test`
  - `corepack pnpm --filter @bukowski/desktop build`
- Evidencia:
  - nuevo hook compartido `useVisiblePolling`
  - `Mission Control`, la top bar y el polling del chat en vivo ya no siguen refrescando igual cuando la app está fuera de foco
  - la app fuerza un refresh oportuno al volver a primer plano, sin dejar al usuario con estado viejo
- Riesgos remanentes:
  - `medio`: esto reduce trabajo desperdiciado, pero no reemplaza profiling profundo con datasets masivos ni virtualización más agresiva
  - `bajo`: el modelo sigue siendo polling, no eventos push; solo quedó bastante menos costoso

### Slice A6 — Sync operability completion
- Estado: `done`
- Objetivo:
  - hacer la cola local más operable y más fácil de debuggear por subconjuntos concretos, sin obligar al usuario a revisar payloads uno por uno
- Área:
  - frontend
- Alcance inicial:
  - filtro por `entityType`
  - `retry visible`
  - búsqueda diferida para payloads grandes
  - deep-link fino a `finance` desde filas del outbox
- Qué se probó:
  - `corepack pnpm --filter @bukowski/desktop typecheck`
  - `corepack pnpm --filter @bukowski/desktop test`
  - `corepack pnpm --filter @bukowski/desktop build`
- Evidencia:
  - `/settings/sync` ahora filtra por estado y por tipo de entidad
  - existe `retry visible` para reencolar solo el subconjunto filtrado que necesita atención
  - la búsqueda usa un valor diferido para no recalcular payloads grandes en cada tecla
  - `financial_entry` ya abre `Finance Entries` con `focus` fino sobre la entry
- Riesgos remanentes:
  - `medio`: `retry visible` hace retries secuenciales a través del bridge actual; si la cola crece mucho convendrá mover esto a una acción bulk nativa en main
  - `medio`: todavía no hay filtros por `operationType` ni export puntual del payload/error desde la vista

## P0 — Crítico ahora mismo

### Slice 1 — Electron Security Hardening
- Estado: `done`
- Objetivo: cerrar la superficie renderer → main → OS
- Área: `backend` + `infra`
- Dependencias: ninguna
- Cambios previstos:
  - CSP en `index.html`
  - CSP reforzado desde `main`
  - validación centralizada de `openExternal`
  - `sandbox: true`
  - `requestSingleInstanceLock()`
  - quitar `databasePath` del renderer
  - sacar código dev-only de builds empaquetados
- Qué se probó:
  - tests unitarios para URLs externas permitidas/bloqueadas
  - `typecheck`
  - `build`
- Evidencia:
  - helper de seguridad y política CSP añadidos
  - `openExternal` y `setWindowOpenHandler` pasan por validación
  - `sandbox: true` activo
  - `requestSingleInstanceLock()` activo
  - CSP separada entre `dev` y `packaged` para no romper el preámbulo de Vite y mantener el build empaquetado más estricto
- Riesgos remanentes:
  - `medio`: en `dev` seguirá apareciendo el warning de Electron por `unsafe-eval`, que es esperado mientras Vite esté activo
  - `medio`: falta smoke manual de doble instancia en app abierta ya empaquetada

### Slice 2 — IPC Validation Layer
- Estado: `done`
- Objetivo: frontera IPC segura con payloads validados y errores sanitizados
- Área: `backend`
- Dependencias: Slice 1
- Cambios previstos:
  - `zod`
  - `safeHandle` / `safeHandleRead`
  - schemas runtime para mutations principales
  - errores sin stack trace ni paths internos
- Qué se probó:
  - `typecheck`
  - suite de tests completa
- Evidencia:
  - schemas de mutación en `packages/contracts/src/validation`
  - `registerFoundationIpc` migrado al wrapper seguro
- Riesgos remanentes:
  - `medio`: los reads ya están sanitizados, pero no todos tienen schema runtime todavía

### Slice 3 — Data Integrity & Recovery
- Estado: `done`
- Objetivo: DB resistente a fallos, reinicios y crecimiento del WAL
- Área: `backend` + `infra`
- Dependencias: Slice 2
- Cambios previstos:
  - backup automático
  - `integrity_check`
  - `foreign_key_check`
  - WAL checkpoint periódico
  - `schema_migrations`
  - fix de `safeStorage`
- Qué se probó:
  - tests unitarios para tracking de migraciones y backup
  - `typecheck`
  - suite de tests completa
- Evidencia:
  - `schema_migrations` formalizado
  - helper para backup / recovery / tracking añadido
  - `safeStorage` ya no finge secreto disponible sin cifrado
  - WAL checkpoint periódico activo
- Riesgos remanentes:
  - `medio`: el restore automático desde backup necesita smoke con DB dañada o simulada

### Slice 4 — Packaging Base para Internal Alpha
- Estado: `done`
- Objetivo: builds internas reproducibles y empaquetables
- Área: `infra`
- Dependencias: Slice 1 y Slice 3
- Cambios previstos:
  - `electron-builder`
  - `@electron/rebuild`
  - scripts de package
  - config de macOS unsigned internal build
- Qué se probó:
  - dependencias instaladas
  - `package:mac`
- Evidencia:
  - `electron-builder.config.cjs`
  - entitlements mínimos
  - scripts de package y rebuild
  - hook `afterSign` con ad-hoc signing profundo y verificación `codesign --deep --strict`
  - script `verify:mac-build` para validar bundles arm64 después de empaquetar
  - artefactos generados en `apps/desktop/dist-packaged`
- Riesgos remanentes:
  - `medio`: sigue siendo un build interno sin notarization
  - `medio`: falta abrir el `.dmg` en una máquina limpia arm64 para smoke real

### Slice 5 — Copy crítico y strings rotos
- Estado: `done`
- Objetivo: quitar señales de prototipo y mezcla de idiomas
- Área: `frontend` + `backend`
- Dependencias: ninguna fuerte
- Cambios previstos:
  - traducir strings visibles en agents
  - reemplazar jerga tipo “command layer still idle”
  - mejorar mensajes de error visibles
- Qué se probó:
  - `typecheck`
  - grep final en copy crítica
  - suite de tests completa
- Evidencia:
  - `agent_config.v1.json` corregido en puntos críticos
  - copy del chat y de approvals endurecido
- Riesgos remanentes:
  - `bajo`: todavía puede quedar copy heredado en datos demo y tests, pero ya no en el flujo principal del usuario

## P1 — Producto usable y más confiable

### Slice 6 — Settings MVP
- Estado: `done`
- Objetivo: dejar de tener una Settings placeholder
- Área: `frontend` + `backend`
- Dependencias: cierre razonable de P0
- Qué se probó:
  - `typecheck`
  - suite de tests completa
  - `build`
- Evidencia:
  - About real
  - snapshot de salud local de base de datos y backups
  - botón de integrity check
  - botón de backup
  - export JSON completo del workspace
- Riesgos remanentes:
  - `medio`: falta smoke manual del export con archivo grande y cancelación del diálogo

### Slice 7 — Incident Lifecycle
- Estado: `done`
- Objetivo: `resolveIncident` + `updateIncident`
- Área: `backend` + `frontend`
- Dependencias: Slice 2
- Qué se probó:
  - `typecheck`
  - suite de tests completa
  - `build`
- Evidencia:
  - contratos, schemas IPC y preload para incidentes resueltos/actualizados
  - panel de detalle de incidentes con edición y resolución desde la misma pantalla
  - read model `getIncidentDetail` reutilizable para UI y tools internos
- Riesgos remanentes:
  - `medio`: todavía no existe adjunto de archivos en incidentes
  - `medio`: falta smoke manual del flujo visual completo en Electron
  - `bajo`: la UI actual prioriza edición/resolución rápida, no un workflow más complejo de escalación
  - `bajo`: no se añadió notificación automática al resolver o cambiar estado

### Slice 8 — Bulk Asset Operations
- Estado: `done`
- Objetivo: assign/move masivo con transacción única
- Área: `backend` + `frontend`
- Dependencias: Slice 2
- Qué se probó:
  - `typecheck`
  - test específico de asignación multi-asset
  - suite de tests completa
  - `build`
- Evidencia:
  - el mutation service ya opera sobre `assetIds[]` en una sola transacción
  - se añadió cobertura explícita para múltiples assets
  - el panel de assign/move deja más claro que la operación aplica al lote completo en un solo comando auditable
- Riesgos remanentes:
  - `medio`: falta confirmar visualmente el flujo de selección múltiple y feedback final con datasets grandes
  - `bajo`: todavía no hay archive masivo ni otras operaciones bulk secundarias

### Slice 9 — Onboarding ligero y empty states
- Estado: `done`
- Objetivo: reducir fricción de primer uso
- Área: `frontend`
- Dependencias: Slice 6, Slice 8
- Qué se probó:
  - `typecheck`
  - suite de tests completa
  - `build`
- Evidencia:
  - nuevo `GuidedEmptyState` reutilizable para primer uso
  - `Catalog` ahora aclara que es el punto de partida cuando el workspace está vacío
  - `Assets` ahora explica el siguiente paso correcto cuando no hay inventario
  - `Project detail` ya no cae en un vacío ambiguo cuando no hay proyecto seleccionado o no hay datos operativos
  - la búsqueda global explica mejor qué se puede buscar y el top bar la hace más visible
- Riesgos remanentes:
  - `medio`: todavía no existe un onboarding guiado multi-step; este slice reduce fricción, pero no reemplaza una experiencia de primer arranque más completa
  - `bajo`: quedan otros empty states secundarios fuera del flujo principal que todavía se pueden pulir más adelante

### Slice 10 — AI / Agents hardening acotado
- Estado: `done`
- Objetivo: mejorar calidad sin abrir otro frente grande
- Área: `backend` + `frontend`
- Dependencias: Slice 9
- Qué se probó:
  - `typecheck`
  - suite de tests completa
  - `build`
- Evidencia:
  - `maxToolCalls` subió a `5`, lo que permite respuestas cross-domain menos superficiales
  - los payloads grandes de tools ahora se truncan antes de volver al modelo, con marca explícita `_truncated`
  - `assistantMemoryService` ahora filtra por scope directamente en SQL y ya no carga todo para recortar en JavaScript
  - se añadió pruning de memory para archivar entradas viejas de baja confianza y limitar crecimiento de la capa activa
  - `Bugs Agent` y `Product Agent` ahora tienen `visibility = internal` y se ocultan de superficies visibles cuando el app corre fuera de contexto interno
- Riesgos remanentes:
  - `medio`: el truncado protege contexto y tokens, pero todavía no hay una capa de resumen semántico de tool payloads; hoy es truncación segura, no compresión inteligente
  - `medio`: los agentes internos siguen existiendo para routing y diagnóstico, así que cualquier cambio futuro en visibilidad debe preservar esa separación
  - `bajo`: el bundle del renderer sigue dando warning de chunk grande en build; no bloquea este slice, pero conviene atacarlo en una fase de polish/performance

## P2 — Profundidad funcional y polish

### Slice 11 — Compare Completion
- Estado: `done`
- Objetivo:
  - convertir el compare tray en una feature real con destino claro y comparación side-by-side
- Área: `frontend`
- Dependencias: Slice 9
- Qué se probó:
  - `typecheck`
  - suite de tests completa
  - `build`
- Evidencia:
  - se creó la vista `/compare` con comparación side-by-side para `assets`, `projects` y `financial_entry`
  - el botón `Compare` del tray ahora navega a una vista real cuando hay al menos dos items compatibles
  - la comparación resalta diferencias por campo y permite quitar items sin salir de la vista
- Riesgos remanentes:
  - `medio`: la vista todavía depende del tray activo en memoria y no persiste una comparación como entidad propia
  - `bajo`: todavía no hay affordance fuerte de “agregar a compare” fuera de los flujos ya existentes de selección/tray

### Slice 12 — Finance Mutations
- Estado: `done`
- Objetivo:
  - dejar de tratar Finance como lectura pura y abrir creación/edición auditables de entries desde la UI
- Área: `backend` + `frontend`
- Dependencias: Slice 11
- Qué se probó:
  - `typecheck`
  - suite de tests completa
  - `build`
- Evidencia:
  - se añadió `financeMutationService` con `createEntry` y `updateEntry`, idempotencia por `command_receipts` y registro en `sync_outbox`
  - IPC y preload ya exponen `bukowskiFinance.create(...)` y `bukowskiFinance.update(...)` con validación runtime vía Zod
  - `Finance Entries` ahora permite crear y editar entries desde un panel dedicado sin salir del registro
  - los read models de finance ahora exponen los campos necesarios para edición (`amountValue`, `currency`, `projectId`, `assetId`, `incidentId`, `description`, `notes`)
- Riesgos remanentes:
  - `medio`: todavía no existe `delete/archive` para finance entries; en esta fase solo abrimos creación y edición segura
  - `medio`: la UI actual permite links opcionales a proyecto/asset/incidente, pero todavía no guía o restringe reglas contables más avanzadas
  - `bajo`: la edición usa catálogos cargados en cliente para selects; si el dataset crece mucho, convendrá pasar a búsqueda remota o lazy loading

### Slice 13 — UX Polish Avanzado
- Estado: `done`
- Objetivo:
  - bajar fricción visual en superficies principales, reemplazar loaders de texto por skeletons y unificar confirmaciones destructivas
- Área: `frontend`
- Dependencias: Slice 12
- Qué se probó:
  - `typecheck`
  - suite de tests completa
  - `build`
- Evidencia:
  - se añadieron `ConfirmDialog` y `TableSkeleton` como componentes compartidos para confirmaciones destructivas y loading states más claros
  - `ShellProjectsPanel`, `CatalogPage` y `AssetEditorPanel` ya no usan confirmaciones nativas inconsistentes; ahora muestran diálogos de confirmación más claros
  - `Assets`, `Catalog`, `Project detail`, `Project budget` y `Packing detail` dejaron de mostrar textos de loading ambiguos y ahora usan skeletons
  - el sidebar de proyectos simplificó sus acciones: los botones de editar/borrar viven en hover/focus y con menos ruido visual
  - `TopContextBar` y `Compare tray` redujeron botones con recuadros innecesarios y dejaron acciones secundarias en formato icon-only cuando aporta limpieza
- Riesgos remanentes:
  - `medio`: el app ya se siente bastante más limpio, pero todavía hay otras superficies con botones pill heredados que convendría revisar en una fase de polish más fina
  - `medio`: los skeletons nuevos cubren los flujos principales, no absolutamente todos los estados de carga del producto
  - `bajo`: el renderer sigue mostrando warning por chunk grande en build; no bloquea este slice, pero entra en deuda visible de performance/polish

### Slice 14 — Shipping más serio
- Estado: `done`
- Objetivo:
  - endurecer la ruta de packaging para builds internas y dejar una base real para release signing, notarization y publicación formal sin romper el flujo actual de internal alpha
- Área: `infra`
- Dependencias: Slice 4, Slice 13
- Qué se probó:
  - `typecheck`
  - suite de tests completa
  - `build`
  - `package:mac`
  - `verify:mac-build`
- Evidencia:
  - el packaging macOS ahora distingue entre dos lanes:
    - internal alpha con ad-hoc signing profundo y verificación local
    - release signing habilitable por entorno con `BUKOWSKI_RELEASE_SIGNING=1`
  - se añadió `notarize-macos.cjs` para encapsular detección de credenciales Apple, notarization con `xcrun notarytool` y stapling
  - se añadió `after-all-artifact-build.cjs` para ejecutar notarization/stapling solo cuando realmente hay credenciales y release signing activo
  - `electron-builder.config.cjs` ahora soporta:
    - `afterAllArtifactBuild`
    - `hardenedRuntime` en release signing
    - identidad automática cuando existe signing real
    - configuración opcional de publicación a GitHub Releases
  - `package.json` ahora incluye scripts separados para:
    - `package:mac`
    - `package:mac:release`
    - `release:github`
  - el rebuild nativo dejó de depender de escribir en `~/.electron-gyp`; ahora usa un `HOME` temporal controlado y `npm_config_devdir` local a `/tmp`, lo que evita fallos de permisos en entornos más restringidos
  - se añadió documentación operativa en `docs/foundation/macos-release-flow.md`
- Riesgos remanentes:
  - `medio`: el build interno queda bien empaquetado y firmado ad-hoc, pero sigue sin notarization real hasta que se inyecten credenciales Apple válidas en el entorno
  - `medio`: la publicación a GitHub Releases quedó preparada, pero todavía falta probarla con versionado/release discipline real
  - `medio`: auto-update runtime todavía no está conectado; este slice deja la base de distribución más seria, no el circuito completo de updates
  - `bajo`: `spctl` puede seguir rechazando el bundle ad-hoc interno en algunas máquinas, lo cual es esperado mientras no exista signing/notarization de distribución

## P3 — Deuda técnica y escalabilidad

### Slice 15 — Read Layer Refactor
- Estado: `done`
- Objetivo:
  - dividir `foundationReadService` por dominios sin cambiar contratos visibles ni romper IPC o snapshots existentes
- Área: `backend`
- Dependencias: Slice 10, Slice 12
- Qué se probó:
  - `typecheck`
  - suite de tests completa
  - `build`
- Evidencia:
  - se extrajeron `projectReadService.ts` y `financeReadService.ts` como primeros servicios de dominio reales
  - se añadió `assetReadService.ts` para mover fuera del monolito los reads principales de assets: summary, overview, list, detail, availability, location, movements, reservations y kits
  - `foundationReadService` ahora funciona como facade para `projects/schedule`, `finance` y `assets`, manteniendo contratos e IPC sin cambios visibles
  - los tests de `foundation-read-service`, `agent-tool-registry` y el resto de snapshots siguen pasando sin cambios de contrato
- Riesgos remanentes:
  - `medio`: `foundationReadService` sigue existiendo como facade amplia y todavía contiene reads cross-domain, búsquedas globales y tooling interno; la deuda bajó bastante, pero no desapareció
  - `bajo`: no hay regresiones funcionales visibles en tests, pero aún conviene hacer smoke manual en rutas que mezclan snapshots de varios dominios

### Slice 16 — Timeline Scalability
- Estado: `done`
- Objetivo:
  - bajar la presión de render y lectura de la timeline antes de entrar en virtualización completa
- Dependencias:
  - `Slice 15 — Read Layer Refactor`
- Área:
  - backend / frontend
- Archivos tocados:
  - `packages/contracts/src/queries/overview-queries.ts`
  - `apps/desktop/electron/main/services/data/projectReadService.ts`
  - `apps/desktop/electron/main/ipc/registerFoundationIpc.ts`
  - `apps/desktop/electron/preload/index.ts`
  - `apps/desktop/src/vite-env.d.ts`
  - `apps/desktop/src/features/overview/useOverviewSnapshot.ts`
  - `apps/desktop/src/features/overview/OverviewPage.tsx`
  - `apps/desktop/src/features/assets/AssetsOverviewPage.tsx`
  - `apps/desktop/src/features/overview/OverviewScheduleTimeline.tsx`
  - `apps/desktop/src/shared/styles/global.css`
  - `apps/desktop/src/test/foundation-read-service.test.ts`
- Backend:
  - `projectReadService.getScheduleTimeline(...)` ahora soporta paginación con `limit` y `offset`
  - el snapshot de timeline ahora devuelve metadata explícita: `totalProjects`, `visibleProjects`, `hasMoreProjects`, `limit`, `offset`
  - IPC y preload quedaron alineados con el nuevo contrato sin romper el resto de surfaces
- Frontend:
  - la timeline ahora carga proyectos por lotes y expone un `Show more projects`
  - `Overview` y `Assets Overview` reinician el límite cuando cambia rango, escala o anchor date
  - la UI muestra claramente cuántos proyectos programados se están renderizando
- Qué se probó:
  - `corepack pnpm --filter @bukowski/desktop typecheck`
  - `corepack pnpm --filter @bukowski/desktop test`
  - `corepack pnpm --filter @bukowski/desktop build`
- Evidencia:
  - `typecheck` OK
  - `test` OK, `46/46`
  - `build` OK
- Riesgos remanentes:
  - `medio`: este slice resuelve paginación/incremental load, pero no virtualiza lanes todavía; con datasets mucho más grandes seguirá siendo deseable una segunda pasada
  - `medio`: el warning de chunk grande sigue visible en build y ya empieza a ser una deuda real de performance de bundle, separada de la timeline
  - `bajo`: falta smoke manual con un dataset más voluminoso para medir la mejora perceptible al hacer `Show more`

### Slice 17 — Multi-workspace, sync y retention
- Estado: `done`
- Objetivo:
  - preparar el código vivo para dejar de depender de strings sueltos de workspace
  - documentar el roadmap formal de sync
  - añadir una política básica de retention que no comprometa datos activos
- Dependencias:
  - `Slice 15 — Read Layer Refactor`
  - `Slice 6 — Settings MVP`
- Área:
  - backend / frontend / infra
- Archivos tocados:
  - `packages/contracts/src/constants.ts`
  - `packages/contracts/src/index.ts`
  - `packages/contracts/src/ipc/types.ts`
  - `apps/desktop/electron/main/services/data/dataRetentionService.ts`
  - `apps/desktop/electron/main/services/data/localDatabase.ts`
  - `apps/desktop/src/features/admin/SettingsPage.tsx`
  - `docs/foundation/sync-roadmap.md`
  - múltiples servicios y superficies activas que ahora importan `DEFAULT_WORKSPACE_ID`
- Backend:
  - se añadió `DEFAULT_WORKSPACE_ID` como contrato compartido en lugar de seguir replicando el string en runtime
  - se creó `dataRetentionService` con una política conservadora:
    - archiva memory entries viejas y de baja confianza
    - purga `sync_outbox` en estado `sent`
    - recorta `runtime_error_events`
    - recorta `assistant_memory_events`
    - purga threads borrados hace tiempo y limpia adjuntos en disco antes de borrar
  - `localDatabase` ahora ejecuta retention en startup y periódicamente sin bloquear el arranque si algo falla
- Frontend:
  - Settings ahora muestra el último retention pass y su resultado resumido
  - superficies activas de agents, chat y varios flows operativos ya usan la constante compartida de workspace
- Infra / documentación:
  - `docs/foundation/sync-roadmap.md` documenta el plan real de sync por fases, límites y dependencias
- Qué se probó:
  - `typecheck`
  - `test`
  - `build`
- Evidencia:
  - nueva prueba dedicada para retention de DB, outbox, runtime errors, memory y limpieza de adjuntos
  - el código vivo ya no depende de `workspace-metadata` en servicios y superficies operativas activas; el hardcode queda acotado al seed demo
- Riesgos remanentes:
  - `medio`: `foundationSeed` sigue usando el id demo fijo; eso es aceptable por ahora, pero sigue siendo deuda si más adelante sembramos workspaces reales
  - `medio`: esto no implementa multi-workspace real, solo preparación segura
  - `medio`: todavía no existe worker de sync ni reconciliación remota; el roadmap ya quedó definido, no ejecutado

## Criterio de actualización
Cada slice se actualiza al arrancar y al cerrar con:
- estado
- archivos tocados
- pruebas corridas
- evidencia concreta
- riesgos remanentes clasificados como `blocker`, `crítico`, `medio` o `bajo`
