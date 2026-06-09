# Packing Slips Audit v1

Fecha: 2026-06-09

## Estado actual

La seccion de Packing Slips ya permite listar slips, abrir detalle, exportar PDF de slip, exportar lista de seguro y registrar devoluciones de equipos pendientes. La pantalla usa el bridge desktop `window.bukowskiPacking` y refresca por `useWorkspaceDataRefreshVersion`, por lo que el flujo principal esta conectado al estado local del workspace.

## Cambios aplicados en S1

- Se agrego una franja de salud arriba de la tabla: slips abiertos, slips vencidos y unidades pendientes.
- La seleccion de filas ahora muestra una barra explicita con acciones seguras: abrir primer slip seleccionado y limpiar seleccion.
- El panel de detalle usa un tratamiento visual glass compartido con Proyectos/Equipos.
- El detalle prioriza datos operativos: proyecto, responsable, fechas, unidades y progreso de devolucion.
- El QR/codigo del slip queda disponible, pero colapsado por defecto para no saturar el rail.
- La accion de devolucion ahora explica si devolvera seleccion o todos los pendientes.

## Hallazgos y deuda pendiente

### MVP

- Backend: validar si `create`, `returnItems`, `exportPdf` y `exportInsurancePdf` escriben outbox/sync con comandos idempotentes y `commandId`.
- Frontend: agregar acciones batch reales para slips seleccionados: exportar PDFs, exportar seguro y marcar revision/seguimiento.
- UX: revisar si el nombre "Packing slips" debe mantenerse o traducirse como "Salidas / devoluciones" para usuarios no tecnicos.

### Hardening

- Sync: documentar matriz para slips, items, devoluciones, archivos exportados y cambios de estado entre maquinas.
- Seguridad: confirmar que export paths pasan por carpeta autorizada y que PDFs no incluyen datos sensibles fuera del workspace.
- Auditoria: registrar actor, fecha, condicion de entrada y notas por cada devolucion parcial.

### Optimizacion

- Performance: paginar o virtualizar detalles con muchos items.
- Operacion: agregar filtros por vencidos, pendientes, proyecto y responsable.
- UX: implementar popover/modal de devolucion asistida para slips grandes, con busqueda dentro de items pendientes.

## Proximo slice recomendado

S2 debe enfocarse en funcionamiento operativo: filtros rapidos por estado/responsable, accion batch de export y matriz de sync para confirmar que Carlos/Jeannette/Ivan ven slips y devoluciones actualizadas entre maquinas.
