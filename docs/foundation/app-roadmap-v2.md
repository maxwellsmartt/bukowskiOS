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
- Estado: `done`
- Objetivo:
  - extender schemas runtime a reads de mayor superficie y riesgo
- Área:
  - backend
- Qué cambió:
  - nuevo set de schemas Zod para reads críticos en `@contracts/validation/read-schemas`
  - nueva variante `safeHandleReadWithSchema(...)` para validar parámetros de lecturas antes de tocar servicios
  - validación añadida a:
    - `global search`
    - `overview/timeline`
    - list/detail reads de `assets`, `packing`, `incidents`, `projects`, `catalog`, `rma` y `finance`
    - app-level reads de `getInfo`, `getDiagnostics`, `getSupportSnapshot` y `getSyncOutboxRows`
- Qué se probó:
  - `corepack pnpm --filter @bukowski/desktop typecheck`
  - `corepack pnpm --filter @bukowski/desktop test`
  - `corepack pnpm --filter @bukowski/desktop build`
- Evidencia:
  - prueba unitaria nueva para `ipcSafeHandler` verificando aceptación de args válidos y rechazo limpio de args inválidos
  - handlers críticos del `main` ya no aceptan payloads arbitrarios en lecturas expuestas
- Riesgos remanentes:
  - `medio`: todavía quedan reads secundarios sin schema runtime, sobre todo en superficies internas de agentes
  - `bajo`: algunos reads simples sin parámetros siguen usando `safeHandleRead` porque el riesgo efectivo ahí es bajo

### Slice P0.3 — Smoke empaquetado arm64
- Estado: `in_progress`
- Objetivo:
  - validar `.dmg` real en Mac arm64 limpia con checklist reproducible
- Área:
  - infra / manual QA
- Qué cambió:
  - checklist de smoke enlazado a una evidencia explícita de macOS arm64
  - build interno y verificación de firma local re-ejecutados
  - evidencia nueva en `docs/foundation/macos-arm64-smoke-evidence-v1.md`
- Qué se probó:
  - `corepack pnpm --filter @bukowski/desktop package:mac`
  - `corepack pnpm --filter @bukowski/desktop verify:mac-build`
  - `codesign --verify --deep --strict apps/desktop/dist-packaged/mac-arm64/bukowskiOS.app`
- Evidencia:
  - `.app` y `.zip` arm64 regenerados
  - `codesign` OK
  - `spctl` falla como esperado en build `internal alpha` ad-hoc no notarizado
- Riesgos remanentes:
  - `medio`: falta smoke manual en Mac arm64 limpia para cerrar instalación/apertura real
  - `medio`: el `.dmg` existente no quedó con timestamp nuevo en esta pasada; conviene regenerarlo y abrirlo durante el smoke limpio

## Fase 1 — Operación visible

### Slice O1 — QR y barcode visibles en UI
- Estado: `done`
- Objetivo:
  - dejar visibles los códigos escaneables más importantes sin depender de PDFs ni tooling externo
- Área:
  - frontend
- Qué cambió:
  - nuevo componente reutilizable para renderizar preview de `QR + Code128`
  - preview visible en `Asset detail` para el código primario del asset
  - preview visible en `Packing slip detail` para el código primario del slip
  - acción simple `Print label` desde `Asset detail`
- Qué se probó:
  - `corepack pnpm --filter @bukowski/desktop typecheck`
  - `corepack pnpm --filter @bukowski/desktop test`
  - `corepack pnpm --filter @bukowski/desktop build`
- Evidencia:
  - los códigos ya no quedan como texto plano en las superficies principales
  - la impresión de etiqueta usa una ventana ligera con QR + barcode + título + código
- Riesgos remanentes:
  - `medio`: falta smoke manual visual para confirmar legibilidad física al imprimir
  - `medio`: el warning de bundle grande sigue visible por chunking general del renderer; no bloquea este slice pero sigue siendo deuda de performance

### Slice O2 — Packing Slip PDF real
- Estado: `done`
- Objetivo:
  - exportar packing slips como PDF real, legible e imprimible desde la propia vista operativa
- Área:
  - backend / frontend
- Qué cambió:
  - export `PDF` desde `Packing detail` usando `pdfkit` en `main`
  - diagramación más cuidada con header, metadatos, QR, notas y tabla de items
  - el archivo sugerido ya usa el número real del slip, no el ID interno
  - ajuste adyacente de UX en `Assets`: scroll horizontal restaurado y tabla un poco más alta para ver más filas
- Qué se probó:
  - `corepack pnpm --filter @bukowski/desktop typecheck`
  - `corepack pnpm --filter @bukowski/desktop test`
  - `corepack pnpm --filter @bukowski/desktop build`
- Evidencia:
  - botón `Export PDF` visible en `PackingSlipDetailPanel`
  - export vía IPC seguro desde `bukowskiPacking:exportPdf`
  - el PDF incluye QR y una tabla de ítems con contexto operativo
- Riesgos remanentes:
  - `medio`: falta smoke manual visual de impresión real y revisión del PDF en Preview/Acrobat
  - `medio`: quedan ajustes finos pendientes en el comportamiento de resize/scroll horizontal de columnas para que se sienta totalmente natural en macOS
  - `medio`: quedan ajustes de diagramación del packing slip PDF para priorizar mejor información operativa y pulir headers/espaciado
  - `bajo`: la impresión nativa directa todavía no entra en este corte; v1 cierra export estable primero

### Follow-up UX.1 — Tabla y PDF de packing
- Estado: `planned`
- Objetivo:
  - cerrar el polish pendiente del resize/scroll horizontal de columnas y el layout final del packing slip PDF
- Área:
  - frontend / backend
- Incluye:
  - resize de columnas más flexible y confiable en tablas grandes
  - control horizontal de `Assets` más integrado visualmente con el sistema
  - revisión final de jerarquía, densidad y relevancia de información en el PDF de packing

### Slice O3 — Uploads para Assets e Incidents
- Estado: `done`
- Objetivo:
  - permitir adjuntar evidencia operativa real a `Assets` e `Incidents` sin salir del app
- Área:
  - backend / frontend
- Qué cambió:
  - nueva migración runtime `runtime_operational_files_v1` para enriquecer `asset_files` e `incident_files` con metadata local
  - nuevo `fileUploadService` para importar archivos al `userData` del app y abrirlos de forma segura
  - bridge nuevo para:
    - adjuntar archivos a assets
    - adjuntar evidencia a incidents
    - abrir archivos guardados
  - `Asset detail` e `Incident detail` ahora muestran los archivos adjuntos con estado, peso y fecha
- Qué se probó:
  - `corepack pnpm --filter @bukowski/desktop typecheck`
  - `corepack pnpm --filter @bukowski/desktop test`
  - `corepack pnpm --filter @bukowski/desktop build`
- Evidencia:
  - pruebas nuevas del servicio de archivos y de lectura de estado `missing`
  - nuevos botones `Attach files` / `Attach evidence` visibles en detail views
- Riesgos remanentes:
  - `medio`: este corte abre y lista archivos, pero todavía no incluye preview inline rico de imágenes/PDFs
  - `medio`: todavía no hay gestión de borrado/replace de archivos adjuntos
  - `bajo`: el cleanup en retention queda listo para un follow-up cuando se active borrado suave de archivos operativos

### Slice O4 — Timeline enriquecida v1
- Estado: `done`
- Objetivo:
  - añadir señales operativas visibles al timeline sin romper legibilidad ni performance
- Área:
  - backend / frontend
- Qué cambió:
  - el snapshot del timeline ahora incluye:
    - `activeIncidentCount`
    - `assignedAssetCount`
    - `crewAssignmentCount`
    - `incidentMarkers`
  - esas señales se muestran en la lane de proyecto y unidad con chips compactos
  - los incidents activos ahora aparecen como markers visuales dentro del rango temporal
- Qué se probó:
  - `corepack pnpm --filter @bukowski/desktop typecheck`
  - `corepack pnpm --filter @bukowski/desktop test`
  - `corepack pnpm --filter @bukowski/desktop build`
- Evidencia:
  - el timeline ya da contexto de carga operativa sin tener que abrir cada proyecto
  - prueba de lectura actualizada para el shape enriquecido del snapshot
- Riesgos remanentes:
  - `medio`: esto es una v1 visible, no conflict detection completa
  - `medio`: si aparecen demasiados incidents en un mismo proyecto, los markers podrían necesitar stacking o filtrado más fino
  - `bajo`: el tooltip de incidents reutiliza la infraestructura existente; si luego quieres drill-down directo, conviene un follow-up específico

### Slice O5 — Conflict detection v1
- Estado: `done`
- Objetivo:
  - detectar conflictos reales de scheduling sin bloquear operaciones válidas y reflejarlos donde el usuario ya trabaja
- Área:
  - backend / frontend / agents
- Qué cambió:
  - detección de `crew overlaps` en `main`, reutilizada por:
    - `Project detail`
    - timeline
    - tool `get_schedule_conflicts`
  - `ProjectUnitRow` y el timeline ahora exponen:
    - `conflictCount`
    - `crewConflictCount`
    - `assetConflictCount`
    - `conflictSummary`
  - `assignCrewToProjectUnit(...)` ya no bloquea por overlap; devuelve el snapshot actualizado y la UI muestra warning visible en la unidad
  - `assignMoveAssets(...)` ahora devuelve warnings cuando un asset sigue ligado a otro proyecto con ventana solapada
  - la UI de `Assets` y `Units` ya muestra feedback warning separado del éxito/error
- Qué se probó:
  - `corepack pnpm --filter @bukowski/desktop typecheck`
  - `corepack pnpm --filter @bukowski/desktop test`
  - `corepack pnpm --filter @bukowski/desktop build`
- Evidencia:
  - tests nuevos para:
    - overlap de crew sin bloqueo duro
    - warnings de assets al reasignar entre ventanas solapadas
  - el timeline ahora muestra chips y barras con señal de conflicto
- Riesgos remanentes:
  - `medio`: en esta v1 la visualización de conflicto en timeline está dominada por `crew overlaps`; los conflictos de assets quedan más fuertes en la mutation que en la vista temporal
  - `medio`: sigue siendo un sistema de warning, no de enforcement duro; eso es deliberado para no romper operación
  - `bajo`: si luego quieres conflicto fino por asset y por unidad, conviene enriquecer más el modelo temporal de `asset_assignments`

## Fase 2 — Finance visible y útil

### Slice F1 — Dashboard financiero con gráficos
- Estado: `done`
- Objetivo:
  - volver `Finance Overview` una superficie de lectura útil, visual y accionable sin abrir todavía banca ni contabilidad pesada
- Área:
  - backend / frontend
- Qué cambió:
  - instalación de `recharts`, `date-fns` y `dinero.js` para soportar visualización y ventanas temporales más sólidas
  - `finance.getOverview` ahora acepta un query runtime-safe con `period` (`month`, `quarter`, `year`, `custom`) y rango custom validado
  - `financeReadService` ahora devuelve:
    - `activePeriodLabel`
    - `totals` para tracked spend, reserves, burn rate e incident exposure
    - serie `monthlyBurn`
    - `categoryBreakdown`
    - `exposureByProject` enriquecido con valores numéricos
  - `FinanceOverviewPage` quedó convertida en dashboard con:
    - selector de período
    - bar chart de exposición por proyecto
    - line chart de burn rate mensual
    - pie chart de mezcla por categoría
    - tabla operativa de exposición por proyecto
  - el panel de insights de agentes ya resume mejor el estado financiero visible
- Qué se probó:
  - `corepack pnpm --filter @bukowski/desktop typecheck`
  - `corepack pnpm --filter @bukowski/desktop test`
  - `corepack pnpm --filter @bukowski/desktop build`
- Evidencia:
  - dashboard financiero ya renderiza métricas, gráficos y filtros temporales sin romper contratos existentes
  - `foundation-read-service.test.ts` actualizado para cubrir burn series, category breakdown y etiqueta de período activa
- Riesgos remanentes:
  - `medio`: el warning de chunking del renderer sigue visible y ahora `vendor` volvió a crecer con la librería de gráficos
  - `medio`: el dataset actual sigue siendo operativo, no contable; los gráficos son útiles para visibilidad, pero no sustituyen reportes financieros formales
  - `bajo`: el estado vacío del dashboard todavía puede aceptar una pasada fina de copy/polish visual

### Slice F2 — Reportes financieros exportables
- Estado: `done`
- Objetivo:
  - permitir exportar un reporte financiero profesional y consistente con la ventana visible del dashboard
- Área:
  - backend / frontend
- Qué cambió:
  - `documentGenerationService` ahora genera `Finance operating report` en PDF con:
    - resumen ejecutivo
    - métricas operativas
    - totales clave
    - exposición por proyecto
    - mezcla por categoría
    - cola pendiente de cost links
  - nuevo canal seguro `finance.exportReportPdf`
  - bridge actualizado en preload y tipos del renderer
  - `FinanceOverviewPage` ahora expone `Export PDF` usando la misma ventana temporal activa del dashboard
- Qué se probó:
  - `corepack pnpm --filter @bukowski/desktop typecheck`
  - `corepack pnpm --filter @bukowski/desktop test -- --run src/test/document-generation-service.test.ts`
  - `corepack pnpm --filter @bukowski/desktop build`
- Evidencia:
  - prueba nueva del servicio de documentos cubriendo también el PDF financiero
  - el export usa el mismo query activo de Finance (`month`, `quarter`, `year`, `custom`) para evitar reportes inconsistentes
- Riesgos remanentes:
  - `medio`: el PDF v1 es claro y profesional, pero todavía no incluye charts embebidos ni branding configurable por workspace
  - `medio`: el warning de chunking del renderer sigue visible y `vendor` se mantiene grande
  - `bajo`: el feedback del export vive en la misma página; si luego el flujo de reportes crece, convendrá una superficie dedicada de reporting

### Slice F3 — Documentos financieros adjuntos
- Estado: `done`
- Objetivo:
  - adjuntar y consultar documentos financieros desde el editor del entry sin sacar al usuario del flujo operativo
- Área:
  - backend / frontend
- Qué cambió:
  - `fileUploadService` ahora crea y usa `financial_documents` dentro del carril de archivos operativos
  - nueva migración runtime `runtime_operational_files_v2` para asegurar la tabla y columnas necesarias
  - `finance` ahora expone:
    - `getDocuments(entryId)`
    - `uploadDocuments(entryId)`
    - `openDocument(fileId)`
  - `financeReadService` devuelve metadata de documentos y preview inline conservadora para imágenes/PDF pequeños
  - `FinanceEntryEditorPanel` ahora muestra:
    - attach documents
    - lista de adjuntos
    - preview inline cuando aplica
    - apertura externa del archivo
- Qué se probó:
  - `corepack pnpm --filter @bukowski/desktop typecheck`
  - `corepack pnpm --filter @bukowski/desktop test -- --run src/test/file-upload-service.test.ts`
  - `corepack pnpm --filter @bukowski/desktop build`
- Evidencia:
  - prueba nueva del carril de uploads financieros validando storage, lectura y `previewDataUrl`
  - el editor de entries ya puede operar documentos financieros sin abrir otra vista aparte
- Riesgos remanentes:
  - `medio`: todavía no existe delete/archive de documentos financieros ni cleanup específico por usuario
  - `medio`: el preview inline usa data URLs y por eso está limitado a archivos previewables y tamaños moderados
  - `bajo`: si este módulo crece mucho, convendrá una vista dedicada de documentos financieros en vez de dejar todo dentro del editor

### Slice F4 — Agent tools financieros ampliados
- Estado: `done`
- Objetivo:
  - dejar al `finance-agent` respondiendo con reads financieros reales y no solo con exposición básica
- Área:
  - backend / AI
- Qué cambió:
  - nuevos reads financieros en `financeReadService`:
    - `getBudgetVsActual(projectId)`
    - `getMonthlyBurnRate({ projectId, months })`
    - `getExpenseBreakdown({ projectId, query })`
    - `getFinancialHealth({ projectId, query })`
  - `agentToolRegistry` ahora expone:
    - `get_budget_vs_actual`
    - `get_monthly_burn_rate`
    - `get_expense_breakdown`
    - `get_financial_health`
  - `finance-agent` amplió su `allowed_tools_json` para usar estos tools junto con `get_project_financials`
  - el supervisor ahora recibe un snapshot financiero compacto cuando la conversación parte desde `/finance`
- Qué se probó:
  - `corepack pnpm --filter @bukowski/desktop typecheck`
  - `corepack pnpm --filter @bukowski/desktop test -- --run src/test/agent-tool-registry.test.ts`
  - `corepack pnpm --filter @bukowski/desktop build`
- Evidencia:
  - `agent-tool-registry.test.ts` actualizado para comprobar que los tools nuevos existen y devuelven payloads útiles
  - el `finance-agent` ya tiene cobertura mejor para burn rate, breakdown, salud financiera y contexto por proyecto
- Riesgos remanentes:
  - `medio`: `get_budget_vs_actual` sigue siendo honesto sobre una limitación del modelo actual: todavía no existe `budget cap` explícito por proyecto
  - `medio`: el supervisor recibe contexto financiero útil, pero todavía no hay inyección especializada equivalente para todos los agentes no financieros
  - `bajo`: el warning de chunking del renderer sigue pendiente fuera de este slice

## Fase 3 — UX estructural

### Slice UX1 — Settings expandido
- Estado: `planned`

### Slice UX2 — Reorganización de navegación
- Estado: `planned`

### Slice UX3 — Polish visual fino
- Estado: `planned`
