# Inventory Core Product Roadmap

## Estado general

**In progress**

Este sub-roadmap pausa temporalmente el roadmap horizontal de auth/workspaces para cerrar el motor operativo del producto: Projects, Assets, asignaciones, Packing Slips, Incidents, RMA, usuarios operativos e import CSV pro.

La meta no es agregar features por ansiedad. La meta es que el flujo diario de inventario se pueda usar con confianza: encontrar assets, importarlos, asignarlos, moverlos, reportar problemas, emitir packing slips, preparar RMA y entender el estado de un proyecto sin leer pantallas técnicas.

## Decisión de foco

- Pausamos momentaneamente Finance/Agents como siguiente slice principal.
- Priorizamos el vertical operativo porque es el centro real del producto.
- Mantenemos los principios del roadmap principal: estabilidad, workspace isolation, permisos, outbox auditable y errores claros.
- Volvemos al roadmap principal cuando este vertical pase smoke real y no tenga blockers de flujo.

## Definición de salida

Este sub-roadmap se considera listo cuando:

- Un usuario puede importar inventario real y entender exactamente que entró, que se saltó y que necesita corrección.
- Un usuario puede encontrar assets rápido por nombre, código, QR, categoría, ubicación, proyecto o estado.
- Un usuario puede asignar/mover assets a proyecto/unidad/responsable sin confusión y con warnings claros.
- Projects, Schedule Overview y Project Detail muestran la misma verdad de proyectos/assets, sin duplicados ni cross-workspace.
- Packing Slips se pueden crear, revisar, exportar y retornar con cantidades consistentes.
- Incidents y RMA están conectados al asset/proyecto y no se sienten como pantallas separadas.
- Usuarios/roles mínimos soportan operación diaria sin bloquear testing.
- Los errores de mala conexión, permisos, datos incompletos e imports fallidos dicen que pasó y que hacer después.
- `typecheck`, tests focalizados y smoke manual operativo pasan.

## Auditoría inicial

### Blockers

- No hay todavía una checklist manual completa para el flujo vertical de inventario end-to-end.
- RMA todavía no está en el mismo nivel de hardening workspace/permissions que Assets, Packing, Incidents y Projects.
- Catalog/CSV import todavía tiene deuda de mapeo pro: categorías, ubicaciones, duplicados, preview por fila y errores recuperables.
- Global Search y algunas lecturas globales todavía pueden necesitar scope por workspace para no enseñar resultados cruzados.

### Crítico

- El inventario ya tiene workspace scoping y outbox, pero los flujos dependientes deben probarse juntos: import -> assign -> packing -> return -> incident -> RMA.
- El usuario necesita feedback consistente cuando una acción escribe estado operacional: asignaciones, movimientos, returns, reportes y RMA.
- Las cantidades son la parte más sensible del producto. Todo flujo bulk debe ser idempotente, auditable y claro sobre stock disponible, reservado, asignado y retornado.

### Medio

- Hay copy técnico restante en paneles operativos: por ejemplo lenguaje de timeline, command, registry, operational command o metadata puede seguir apareciendo.
- Algunas pantallas tienen demasiados campos visibles al abrir, especialmente assign/move, incident report, packing builder y RMA editor.
- Project detail, Schedule Overview y Assets pueden repetir información; hay que elegir una fuente visible principal por contexto.
- Los empty states deben distinguir entre "no hay datos", "no tienes permiso", "workspace cargando" y "falló la conexión".

### Bajo

- Hay polish pendiente de PDF/print, densidad de tablas y shortcuts.
- Algunas acciones todavía pueden necesitar tooltip/aria-label o unificación de tamaño/estilo.

## Slices

### Slice IC-0 — Baseline y smoke operativo

**Estado:** Doing

Objetivo:

Crear una prueba manual y automatizada mínima que represente el uso real del producto antes de tocar más UI.

Incluye:

- Done — Escribir checklist de smoke vertical en `docs/foundation/inventory-core-smoke-checklist.md`.
- Done — Definir dataset actual para `Metadata Cine2`: 6 active projects, 629 assets, stock total 1727, available 1726, assigned 1, checked out 0.
- Probar navegación: Assets, asset detail, Projects, Schedule Overview, Project Assets, Packing, Incidents, RMA.
- Registrar qué falla hoy con severidad y archivo/superficie probable.

Hallazgos de baseline:

- `Metadata Cine2`: 6 active projects y 629 active assets.
- `workspace-metadata`: 6 active projects y 789 active assets; todavía conserva Packing/Incidents/RMA seed/demo.
- Packing/Incidents/RMA no tienen datos reales en `Metadata Cine2` todavía.
- RMA estaba redirigido a Incidents en UI y el data layer todavía usaba `DEFAULT_WORKSPACE_ID`.
- Catalog read/mutation todavía depende de `DEFAULT_WORKSPACE_ID`; se considera parte de IC-1.

Pruebas:

- `npm run typecheck`
- tests focalizados de assets/projects/packing/incidents/rma
- smoke manual en app dev

### Slice IC-1 — Data consistency y workspace scope del core

**Estado:** Doing

Objetivo:

Cerrar cualquier lectura o mutación del vertical operativo que todavía pueda mezclar workspace, usar defaults viejos o mostrar datos cruzados.

Incluye:

- Auditar Global Search para scope por workspace.
- Auditar Catalog usado por Assets/Projects/Packing/Incidents/RMA.
- Done — Extender workspace guard/read scope a RMA snapshot/detail/create/update.
- Doing — Extender workspace scope a Catalog reads como dependencia de RMA y Assets/Projects.
- Confirmar que Project sidebar, Projects table, Schedule Overview y Project detail comparten el mismo criterio de visible projects.
- Verificar que Packing/Incidents/RMA detail resuelven workspace desde su entidad antes de leer o mutar.

Pruebas:

- Done — Tests de workspace access para RMA.
- Done — Test de RMA snapshot con dos workspaces.
- Done — Verificación: `npm run typecheck`.
- Done — Verificación: `npm run test -- foundation-read-service workspace-access-guard`.
- Tests de workspace access para Catalog.
- Tests de timeline/list/detail con dos workspaces.
- Smoke con `Metadata Cine2` y `workspace-metadata` coexistiendo.

### Slice IC-2 — Assets table + detail a nivel producto

**Estado:** Todo

Objetivo:

Dejar Assets como la consola principal de inventario: rápida, clara, confiable y con acciones donde el usuario las espera.

Incluye:

- Revisar columnas default y orden: nombre/código, categoría, stock, estado, proyecto, ubicación, origen/import.
- Pulir selección bulk y acciones en header sin barras que muevan layout.
- Revisar asset detail para separar lectura principal, estado actual, archivos, incidents/RMA y metadata secundaria.
- Asegurar que create/edit asset no abre con ruido innecesario.
- Confirmar que códigos QR/barcode y copy actions son claros.

Pruebas:

- Buscar, filtrar, ordenar, reordenar columnas, undo de reorder.
- Crear asset, editar asset, archivar asset.
- Abrir asset detail desde tabla y desde búsqueda.

### Slice IC-3 — Assign / move como flujo operacional central

**Estado:** Todo

Objetivo:

Hacer que assign/move sea simple para casos normales y seguro para casos complejos.

Incluye:

- Reducir copy técnico del panel.
- Orden progresivo: selección -> modo -> proyecto/unidad/responsable -> cantidad/fechas -> ubicación/notas.
- Mostrar warnings de stock, conflicto y proyecto solapado sin bloquear operaciones válidas.
- Confirmar auditoría en `asset_events` y outbox.
- Hacer que success/error explique qué cambió.

Pruebas:

- Asignar 1 asset.
- Asignar bulk con cantidad parcial.
- Mover asset asignado.
- Intentar operación con permisos insuficientes.
- Simular mala conexión/outbox pending.

### Slice IC-4 — Packing Slips end-to-end

**Estado:** Todo

Objetivo:

Packing debe sentirse como documento operacional real, no como tabla técnica.

Incluye:

- Builder más corto y progresivo.
- Selección desde Assets y creación directa desde Packing.
- Cantidades consistentes con asignaciones y returns.
- PDF/print smoke.
- Return flow claro: parcial, completo, overdue.
- Estados y colores consistentes.

Pruebas:

- Crear slip desde selección.
- Export PDF.
- Return parcial.
- Return completo.
- Validar cambios en asset current state.

### Slice IC-5 — Incidents + RMA conectados

**Estado:** Todo

Objetivo:

Que reportar un problema lleve naturalmente a seguimiento, evidencia, costo/RMA si aplica y resolución.

Incluye:

- Incident report más corto y menos técnico.
- Incident detail con contexto de asset/proyecto y evidencia clara.
- RMA desde incident o asset cuando el daño/reparación lo amerite.
- RMA list/detail con workspace guard, estados claros y archivos.
- Evitar duplicar info entre Incident Detail, Asset Detail y RMA Detail.

Pruebas:

- Reportar incident desde project y desde asset.
- Adjuntar evidencia.
- Crear RMA desde un asset/incidente.
- Cambiar estado de RMA.
- Resolver incident.

### Slice IC-6 — CSV import pro

**Estado:** Todo

Objetivo:

Convertir el import CSV de MVP a flujo confiable para inventarios reales.

Incluye:

- Preview por fila con importable, warning, duplicate, skipped, error.
- Mapping de columnas con aliases Rentman/español.
- Creación guiada o sugerida de categorías/ubicaciones faltantes.
- Duplicados internos y existentes con explicación clara.
- Import idempotente con resumen final.
- Template descargable o copy de formato esperado.

Pruebas:

- CSV real Rentman.
- CSV con headers incompletos.
- CSV con duplicados.
- Reintento del mismo CSV.
- Import cancelado antes de escribir.

### Slice IC-7 — Usuarios operativos mínimos

**Estado:** Todo

Objetivo:

Soportar operación diaria sin resolver todo Roles/Invites completo.

Incluye:

- Confirmar roles mínimos: admin, operations supervisor, logistics operator, VTR operator.
- UI clara para quién puede importar, asignar, crear packing, reportar incidents y crear RMA.
- Mensajes de permisos user-friendly.
- No bloquear testing por permisos incompletos.

Pruebas:

- Acciones críticas con admin.
- Acciones permitidas/rechazadas con operador.
- Mensajes de error sin jerga.

## Orden recomendado

1. IC-0 — Baseline y smoke operativo.
2. IC-1 — Data consistency y workspace scope.
3. IC-3 — Assign / move.
4. IC-4 — Packing Slips.
5. IC-5 — Incidents + RMA.
6. IC-6 — CSV import pro.
7. IC-2 — Assets table/detail polish fino.
8. IC-7 — Usuarios operativos mínimos.

Nota: IC-2 puede avanzar en paralelo de forma ligera, pero no debe bloquear IC-3/IC-4 porque assign/packing son los flujos que más prueban la verdad operacional.

## Qué queda fuera por ahora

- Finance avanzado.
- Agents/Automation.
- Notificaciones completas.
- Sharing externo.
- Workspaces CRUD completo.
- Notarization pública.

## Criterio para volver al roadmap principal

Volvemos al roadmap principal cuando:

- IC-0 a IC-5 estén cerrados o sin blockers.
- CSV import pro tenga al menos preview robusto y reintento seguro.
- No existan datos cruzados entre `workspace-metadata` y `Metadata Cine2` en el vertical operativo.
- El smoke manual vertical pase dos veces seguidas en dev.
- El usuario pueda hacer una demo completa de inventario sin explicar workarounds.

## Próximo paso inmediato

Empezar por **IC-0**:

- Crear checklist manual de smoke vertical.
- Correr la auditoría en app dev con datos actuales.
- Abrir issues/tareas internas por blocker.
- Después empezar IC-1 con RMA/Catalog/Global Search workspace scope.
