# Inventory Core Smoke Checklist

## Objetivo

Validar el flujo operativo real del app: importar inventario, encontrar assets, asignarlos a proyectos, crear packing slips, reportar incidents y preparar RMA sin mezclar workspaces ni depender de conocimiento técnico.

## Preparación

- App corriendo en dev.
- Usuario logueado.
- Workspace activo: `Metadata Cine2`.
- Supabase project despierto.
- SQLite local con backup reciente.

## Smoke 1 — Workspace y navegación

- Abrir app desde reload limpio.
- Confirmar que no aparece brevemente un workspace que no se puede seleccionar.
- Confirmar que el sidebar de Projects muestra sólo proyectos de `Metadata Cine2`.
- Abrir `Projects`.
- Abrir `Schedule Overview`.
- Confirmar que el timeline muestra los mismos proyectos visibles que el sidebar.
- Abrir `Assets`.
- Abrir `Packing Slips`.
- Abrir `Incidents`.
- Abrir `RMA`.

Resultado esperado:

- No hay datos de `workspace-metadata` mezclados en vistas del workspace activo.
- No hay errores transitorios como "workspace is not available on this device".

## Smoke 2 — Assets search/table/detail

- Buscar un asset por nombre.
- Buscar un asset por código.
- Cambiar sort.
- Abrir columnas.
- Reordenar columnas con drag.
- Usar undo de columnas con `Cmd+Z`.
- Abrir asset detail.
- Confirmar estado actual, cantidad, ubicación/proyecto y códigos.
- Adjuntar o abrir archivo si hay fixture disponible.

Resultado esperado:

- La tabla no pierde scroll.
- La selección de texto no se activa durante drag de columnas.
- Asset detail no duplica información innecesaria.

## Smoke 3 — Assign / move

- Seleccionar 1 asset disponible.
- Abrir `Assign / move`.
- Asignar a un proyecto activo.
- Confirmar success claro.
- Confirmar que el asset cambia de estado/proyecto.
- Volver a abrir `Schedule Overview`.
- Confirmar que el timeline refleja la carga asignada.
- Repetir con una selección bulk pequeña.

Resultado esperado:

- Cantidades disponibles y asignadas se mantienen consistentes.
- Se crea evento auditable.
- Si hay warning, no se mezcla con error.

## Smoke 4 — Packing Slip

- Desde Assets, seleccionar assets asignables.
- Crear packing slip.
- Revisar detalle del slip.
- Exportar PDF.
- Registrar return parcial si aplica.
- Registrar return completo si aplica.

Resultado esperado:

- El slip conserva proyecto, responsable, departamento, cantidades y due date.
- El PDF se abre y es legible.
- Returns actualizan cantidades sin duplicar eventos.

## Smoke 5 — Incidents

- Reportar incident desde asset o proyecto.
- Confirmar que aparece en lista de incidents.
- Abrir incident detail.
- Adjuntar evidencia.
- Cambiar estado o resolver.
- Confirmar que asset/project reflejan el incident cuando corresponde.

Resultado esperado:

- El formulario es corto y claro.
- El usuario entiende el siguiente paso.
- No aparecen labels técnicos.

## Smoke 6 — RMA

- Crear RMA desde un asset con issue.
- Revisar RMA list/detail.
- Cambiar estado.
- Confirmar relación con asset/incidente si aplica.

Resultado esperado:

- RMA está scoped al workspace activo.
- Estados son claros.
- No hay datos cruzados.

## Smoke 7 — CSV import pro

- Abrir Assets.
- Seleccionar `Import CSV`.
- Cargar CSV real Rentman.
- Revisar preview antes de importar.
- Confirmar importable/skipped/warnings.
- Cancelar antes de escribir.
- Repetir y completar import en un archivo pequeño de prueba.

Resultado esperado:

- El usuario sabe qué se va a crear antes de escribir.
- Reintentar el mismo CSV no duplica stock.
- Errores por fila son accionables.

## Verificación automatizada

```bash
npm run typecheck
npm run test -- asset-mutation-service packing-mutation-service incident-mutation-service project-mutation-service foundation-read-service workspace-access-guard
```

## Criterios de fallo

- `blocker`: datos cruzados entre workspaces en cualquier vista operativa.
- `blocker`: pérdida o duplicación de cantidades.
- `crítico`: acción operativa escribe sin feedback o con estado incorrecto.
- `crítico`: RMA/Packing/Incident permite leer o mutar entidad de otro workspace.
- `medio`: copy técnico confunde una acción común.
- `medio`: layout se mueve o esconde acciones al seleccionar elementos.
- `bajo`: inconsistencia visual que no bloquea operación.
