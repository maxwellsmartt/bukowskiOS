# BukowskiOS — Roadmap expandido v2

## Resumen
- Meta inmediata: **alpha interna sólida con mejoras visibles de operación**
- Regla operativa: **estabilidad, soporte y consistencia antes de abrir arquitectura nueva**
- Fuera del frente inmediato:
  - `auth` / multi-user
  - `voice`
  - reorganización grande de navegación

## Fase 0 — Plataforma y soporte

### Slice P0.1 — Logging y soporte exportable
- Estado: `done`
- Objetivo:
  - añadir file logging local y una superficie de soporte en `Settings` sin reemplazar `runtimeDiagnosticsService`
- Área:
  - backend / infra / frontend
- Qué cambió:
  - `electron-log` integrado en `main`
  - logger central con sanitización de secretos y archivos diarios en el directorio local de soporte
  - snapshot de soporte con último crash, último error fuerte, último `did-fail-load` / `render-process-gone`
  - export de logs recientes y support bundle desde `Settings`
- Qué se probó:
  - `corepack pnpm --filter @bukowski/desktop typecheck`
  - `corepack pnpm --filter @bukowski/desktop test`
  - `corepack pnpm --filter @bukowski/desktop build`
- Evidencia:
  - nueva sección `Support` en `Settings`
  - nuevos IPC app-level para snapshot y export
  - tests nuevos para logger y support diagnostics
- Riesgos remanentes:
  - `medio`: todavía no hay integración con servicios externos como Sentry
  - `medio`: el support bundle v1 exporta carpeta estructurada, no `.zip`

### Slice P0.2 — Read validation crítica
- Estado: `planned`
- Objetivo:
  - extender schemas runtime a reads de mayor superficie y riesgo
- Área:
  - backend
- Alcance inicial:
  - global search
  - overview/timeline
  - detail queries principales
  - app-level reads de sync/support

### Slice P0.3 — Smoke empaquetado arm64
- Estado: `planned`
- Objetivo:
  - validar `.dmg` real en Mac arm64 limpia con checklist reproducible
- Área:
  - infra / manual QA
- Alcance inicial:
  - install/open
  - single-instance
  - export data
  - support bundle
  - sync queue

## Fase 1 — Operación visible

### Slice O1 — QR y barcode visibles en UI
- Estado: `planned`

### Slice O2 — Packing Slip PDF real
- Estado: `planned`

### Slice O3 — Uploads para Assets e Incidents
- Estado: `planned`

### Slice O4 — Timeline enriquecida v1
- Estado: `planned`

### Slice O5 — Conflict detection v1
- Estado: `planned`

## Fase 2 — Finance visible y útil

### Slice F1 — Dashboard financiero con gráficos
- Estado: `planned`

### Slice F2 — Reportes financieros exportables
- Estado: `planned`

### Slice F3 — Documentos financieros adjuntos
- Estado: `planned`

### Slice F4 — Agent tools financieros ampliados
- Estado: `planned`

## Fase 3 — UX estructural

### Slice UX1 — Settings expandido
- Estado: `planned`

### Slice UX2 — Reorganización de navegación
- Estado: `planned`

### Slice UX3 — Polish visual fino
- Estado: `planned`
