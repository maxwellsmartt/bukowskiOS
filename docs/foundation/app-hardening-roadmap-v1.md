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
- Estado: `in_progress`
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
  - `foundationReadService` ahora ya funciona como facade parcial para `projects/schedule` y `finance`
  - los tests de `foundation-read-service`, `agent-tool-registry` y el resto de snapshots siguen pasando sin cambios de contrato
- Riesgos remanentes:
  - `medio`: el monolito bajó presión, pero `assets` y otros reads cross-domain siguen dentro de `foundationReadService`
  - `medio`: conviene seguir con la extracción de `assetReadService` antes de marcar este slice como `done`
  - `bajo`: no hay regresiones funcionales visibles en los tests actuales, pero todavía falta smoke manual de rutas que mezclan varios snapshots

### Slice 16 — Timeline Scalability
- Estado: `planned`

### Slice 17 — Multi-workspace, sync y retention
- Estado: `planned`

## Criterio de actualización
Cada slice se actualiza al arrancar y al cerrar con:
- estado
- archivos tocados
- pruebas corridas
- evidencia concreta
- riesgos remanentes clasificados como `blocker`, `crítico`, `medio` o `bajo`
