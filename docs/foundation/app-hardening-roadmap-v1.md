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
- Estado: `planned`
- Objetivo: reducir fricción de primer uso
- Área: `frontend`

### Slice 10 — AI / Agents hardening acotado
- Estado: `planned`
- Objetivo: mejorar calidad sin abrir otro frente grande
- Área: `backend` + `frontend`

## P2 — Profundidad funcional y polish

### Slice 11 — Compare Completion
- Estado: `planned`

### Slice 12 — Finance Mutations
- Estado: `planned`

### Slice 13 — UX Polish Avanzado
- Estado: `planned`

### Slice 14 — Shipping más serio
- Estado: `planned`

## P3 — Deuda técnica y escalabilidad

### Slice 15 — Read Layer Refactor
- Estado: `planned`

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
