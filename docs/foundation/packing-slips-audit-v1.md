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

## Cambios aplicados en S2.1

- Se agregaron filtros rapidos por todos, abiertos, vencidos, pendientes y cerrados.
- La tabla ahora muestra el conteo filtrado en el buscador y conserva la seleccion dentro de las filas visibles.
- La seleccion de slips permite exportar PDFs de slips o PDFs de seguro en batch usando los comandos existentes.
- La exportacion batch corre una sola pasada sin retries largos y reporta resumen parcial si alguna fila falla.

## Cambios aplicados en S2.2 - matriz de sync

Objetivo: confirmar que Packing Slips no dependa de "me funciono en mi maquina", sino de una cadena local-first auditable: mutacion local, outbox, snapshot remoto, pull remoto, apply idempotente y visibilidad en otra Mac del mismo workspace.

### Matriz de cobertura

| Flujo | Tablas locales afectadas | Push local -> remoto | Pull remoto -> local | Assets afectados | Visibilidad entre maquinas | Estado | Riesgo / falta |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Crear packing slip | `packing_slips`, `packing_slip_items`, `asset_assignments`, `asset_events`, `asset_current_state`, `sync_outbox`, `command_receipts` | Si. `createPackingSlip` encola `asset_event` por asset y `packing_slip`; el transport resuelve snapshot completo hacia `operational_snapshots`. | Si. `useOperationalSnapshotPull` baja `entity_type='packing_slip'` y `applyPackingSnapshot` materializa slip/items. | Si. El asset queda `checked_out`, baja disponibilidad y sube `checked_out_quantity`; viaja tambien como `asset_event`. | Parcialmente cubierto por codigo. Requiere smoke real Mac A -> Mac B con build actual. | MVP cubierto | Si el asset remoto no baja antes que el slip, el item se puede saltar hasta que el asset exista localmente. Validar orden con smoke. |
| Devolucion parcial | `packing_slip_items.returned_at/condition_in`, `packing_slips.status`, `asset_assignments`, `asset_events`, `asset_current_state`, `sync_outbox`, `command_receipts` | Si. `returnPackingSlipItems` encola `asset_event` por item devuelto y `packing_slip` con status actualizado. | Si. Snapshot remoto trae items actualizados; apply upserta por `(packing_slip_id, asset_id)`. | Si. Resta `checked_out_quantity`; si venia de reserva de proyecto, vuelve a `assigned_quantity`; si no, vuelve a `available_quantity`. | Parcialmente cubierto por tests locales; falta smoke Mac A devuelve item y Mac B ve status `Partial return`. | MVP cubierto | No hay UI de conflicto si dos usuarios devuelven el mismo item casi al mismo tiempo; command receipts protegen localmente, pero falta prueba multiusuario. |
| Devolucion total / cierre | `packing_slips.status='Closed'`, items devueltos, assets liberados o reasignados | Si. Mismo flujo que devolucion parcial; status se deriva por conteo de cantidades devueltas. | Si. Snapshot completo actualiza status e items. | Si. Todos los items pendientes se actualizan en `asset_current_state`. | Parcialmente cubierto por test local; falta smoke Mac A cierra y Mac B deja de verlo como abierto/pendiente. | MVP cubierto | LWW por snapshot completo; si una Mac trabaja stale sobre un slip ya cerrado, debe fallar por "already returned" local despues de pull, pero falta prueba real. |
| Cambios de estado | `packing_slips.status`, `packing_slip_items.returned_at`, `updated_at` | Si para estados derivados por create/return. No hay editor libre de status, lo cual reduce estados ambiguos. | Si por `updated_at` de snapshot operacional. | Indirecto: estado de slip y estado de assets viajan por rutas separadas (`packing_slip` + `asset_event`). | Cubierto a nivel mecanismo; pendiente validar con datos reales. | MVP cubierto | El remote snapshot no aplica estado de asset por si solo; depende de sync de assets/eventos. |
| Assets afectados por salida/devolucion | `asset_current_state`, `asset_assignments`, `asset_events` | Si por `asset_event` outbox. | Si por asset snapshot/pull y eventos segun cobertura de Assets. | Si. La logica local calcula cantidades y custody status. | Parcial: Packing puede verse antes de que el asset current state remoto termine de bajar. | Mitigado | Necesitamos smoke cruzado Packing + Assets: tabla de equipos debe reflejar checked out/available igual que el detalle de slip. |
| Backfill historico | `sync_outbox` con `snapshot_backfill` para `packing_slip` | Si desde Sync Activity/backfill operacional. | Si por `operational_snapshots`. | No recalcula eventos de assets; solo publica snapshot actual del slip/items. | Cubre slips ya existentes antes del sync nuevo. | Cubierto con deuda | Confirmar que se ejecuto backfill en workspace real actual; si no, slips antiguos pueden no aparecer en otra Mac hasta que se editen. |
| Export PDF / insurance PDF | Archivos generados localmente desde detalle actual | No aplica como source of truth; exportar no crea estado remoto. | No aplica. | No cambia assets. | Cada Mac puede generar su propio PDF desde datos sincronizados. | Correcto | No sincronizar PDFs exportados es intencional por ahora. Si se requiere historial legal, crear storage/audit trail futuro. |
| Archivos adjuntos del slip | No hay flujo universal de adjuntos propios de packing en este slice. | No cubierto. | No cubierto. | No aplica. | No aplica. | Hardening futuro | Si packing llega a tener fotos/firmas/documentos adjuntos, requiere bucket RLS + metadata sync. |

### Veredicto S2.2

- **MVP funcional**: la creacion, devolucion parcial, devolucion total y cambio de estado derivado tienen base local-first, outbox y snapshot remoto.
- **Riesgo critico restante**: falta smoke real con dos Macs/usuarios en el workspace actual. El codigo esta preparado, pero despues de lo ocurrido con Facturas/Cuentas no debemos declarar "confiable" sin validar datos reales cruzados.
- **Riesgo medio**: Packing y Assets sincronizan por rutas relacionadas pero separadas. Puede haber una ventana temporal donde un slip aparece en Mac B antes de que el estado visual del asset termine de reflejar `checked_out`/`available`.
- **Decision de producto**: PDFs exportados no se sincronizan como archivo; se regeneran desde datos. Esto es correcto para MVP, pero no sirve como historial legal firmado.

### Smoke recomendado para cerrar S2.2

1. Mac A: crear packing slip con 2 assets disponibles para un proyecto activo.
2. Mac A: confirmar en Sync Activity que `packing_slip` y `asset_event` quedan `sent`.
3. Mac B: esperar pull o forzar refresh; confirmar que aparece el slip, items, proyecto/responsable y assets como fuera en packing.
4. Mac B: devolver 1 asset; confirmar status `Partial return` en Mac B.
5. Mac A: confirmar que el mismo slip cambia a `Partial return`, que el item devuelto muestra `condition_in/returned_at` y que el asset vuelve a disponible/asignado segun `source_flow`.
6. Mac A o B: devolver el resto; confirmar status `Closed` en ambas maquinas.
7. Generar PDF/insurance PDF en ambas maquinas y validar que salen desde el mismo estado sincronizado, sin asumir que el archivo exportado se comparte.

## Hallazgos y deuda pendiente

### MVP

- Backend: ejecutar smoke multiusuario real de S2.2 y guardar evidencia de logs/sync activity.
- Frontend: evaluar si hace falta una accion batch adicional de revision/seguimiento para slips seleccionados.
- UX: revisar si el nombre "Packing slips" debe mantenerse o traducirse como "Salidas / devoluciones" para usuarios no tecnicos.

### Hardening

- Sync: agregar indicador visible si un slip tiene snapshot aplicado pero sus assets relacionados aun no terminaron de hidratarse.
- Seguridad: confirmar que export paths pasan por carpeta autorizada y que PDFs no incluyen datos sensibles fuera del workspace.
- Auditoria: registrar actor, fecha, condicion de entrada y notas por cada devolucion parcial.
- Conflictos: definir comportamiento cuando dos usuarios intentan devolver el mismo item desde estados stale.

### Optimizacion

- Performance: paginar o virtualizar detalles con muchos items.
- Operacion: agregar filtros por vencidos, pendientes, proyecto y responsable.
- UX: implementar popover/modal de devolucion asistida para slips grandes, con busqueda dentro de items pendientes.

## Proximo slice recomendado

S2.3 debe ejecutar el smoke real Mac A/Mac B y, si aparece divergencia, corregir primero la causa de sync antes de seguir puliendo UI.
