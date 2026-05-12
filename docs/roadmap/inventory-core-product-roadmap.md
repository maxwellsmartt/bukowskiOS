# Inventory Core Product Roadmap

## Estado general

**Ready to return to main roadmap**

Este sub-roadmap pausa temporalmente el roadmap horizontal de auth/workspaces para cerrar el motor operativo del producto: Projects, Assets, asignaciones, Packing Slips, Incidents, RMA, usuarios operativos e import CSV pro.

La meta no es agregar features por ansiedad. La meta es que el flujo diario de inventario se pueda usar con confianza: encontrar assets, importarlos, asignarlos, moverlos, reportar problemas, emitir packing slips, preparar RMA y entender el estado de un proyecto sin leer pantallas técnicas.

Actualización 2026-04-29:
- El vertical operativo ya tiene suficiente base para volver al roadmap principal.
- Quedan smoke manuales y polish fino, pero no hay blocker conocido que impida avanzar a `Settings / Advanced`.
- Los pendientes de IC-4/IC-5 se mantienen como verificación manual, no como razón para seguir abriendo features en inventario.

Actualización 2026-05-05:
- El foco pasa de inventario aislado a **pilot readiness**: login/auth, multiusuario, sync completo y smoke operacional para que Iván y Carlos puedan operar sin workarounds.
- Sync Activity queda como preflight obligatorio del piloto: si hay `failed`, `pull required`, cola pendiente inesperada o cobertura de download incompleta, se corrige antes del smoke.
- Se inicia polish visual transversal de controles: filtros con muchas opciones migran a dropdowns y los pills quedan reservados para estados, toggles pequeños o quick actions.
- Queda pendiente smoke manual explícito de Projects -> Packing Slips -> Incidents -> RMA con dos usuarios.
- Se implementa primer corte de sync para Projects, Packing Slips, Incidents y RMA vía snapshots operativos en Supabase. La migración remota fue aplicada y ahora existe backfill idempotente desde Sync Activity; queda pendiente ejecutarlo en data real y validar pull/push con dos dispositivos/usuarios.
- Se extiende `workspaceAccess` fuera de inventario a Finance, Currency y Quotes. Agents queda como deuda separada porque todavía usa `DEFAULT_WORKSPACE_ID` internamente y requiere refactor de runtime, no sólo guard de IPC.

Actualización 2026-05-12:
- Se cerró una unidad de localización visible para **Incidents + RMA**: listas, panel de reporte, detalle de incidente, archivos, handoff a reparación, RMA list/detail/editor, estados, severidades, columnas, placeholders, toasts y empty states ahora consumen `i18n`.
- Se mantuvieron intactos los valores internos (`Open`, `Resolved`, `Needs review`, `No repair / retired`, etc.) para no romper contratos, sync snapshots ni tests de mutación.
- Queda como deuda menor traducir/parametrizar el cuerpo generado del mailto de RMA; no bloquea UI ni flujo operativo.

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
- RMA ya tiene guard/read scope en tests, pero falta smoke manual dentro del flujo Incidents -> RMA.
- Catalog/CSV import todavía tiene deuda de mapeo pro: creación guiada de categorías/ubicaciones, preview por fila y errores recuperables.
- Global Search quedó auditado y probado para assets/projects/packing/incidents; falta decidir si debe incluir finance entries antes de reactivar Finance como slice.

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
- 2026-04-28: la auditoría posterior al trabajo vertical encontró que Global Search ya estaba scoped por workspace y con test de aislamiento, pero quedaban fallbacks viejos de Catalog en project catalog/blueprint export.

Pruebas:

- `npm run typecheck`
- tests focalizados de assets/projects/packing/incidents/rma
- smoke manual en app dev

### Slice IC-1 — Data consistency y workspace scope del core

**Estado:** Doing

Objetivo:

Cerrar cualquier lectura o mutación del vertical operativo que todavía pueda mezclar workspace, usar defaults viejos o mostrar datos cruzados.

Incluye:

- Done — Auditar Global Search para scope por workspace.
- Done — Auditar Catalog usado por Assets/Projects/Packing/Incidents/RMA.
- Done — Extender workspace guard/read scope a RMA snapshot/detail/create/update.
- Done — Extender workspace scope a Catalog reads como dependencia de RMA y Assets/Projects.
- Done — Cerrar fallback legacy `bukowskiProjects.getCatalog()` para exigir `workspaceId` y validar acceso antes de cargar catálogo.
- Done — Scopear catalog/assets usados por `exportProjectBlueprintPdf` al `workspaceId` del blueprint.
- Done — Reforzar metadata de kits en `assetOptions` para no mostrar kits de otro workspace aunque existan filas inconsistentes en `kit_assets`.
- Confirmar que Project sidebar, Projects table, Schedule Overview y Project detail comparten el mismo criterio de visible projects.
- Verificar que Packing/Incidents/RMA detail resuelven workspace desde su entidad antes de leer o mutar.

Pruebas:

- Done — Tests de workspace access para RMA.
- Done — Test de RMA snapshot con dos workspaces.
- Done — Verificación: `npm run typecheck`.
- Done — Verificación: `npm run test -- foundation-read-service workspace-access-guard`.
- Done — Test de Catalog/Global Search con dos workspaces.
- Done — Test de no-leak de linked kit metadata entre workspaces.
- Tests de timeline/list/detail con dos workspaces.
- Smoke con `Metadata Cine2` y `workspace-metadata` coexistiendo.

Findings 2026-04-28:

- Crítico mitigado — `GlobalSearch` ya filtra por `workspaceId` y tiene test de aislamiento para proyecto/catálogo de otro workspace.
- Crítico mitigado — `projects.getCatalog` seguía expuesto sin argumentos y cargaba el catálogo default; ahora requiere workspace explícito y valida `projects.read`.
- Medio mitigado — `exportProjectBlueprintPdf` leía catálogo/assets default; ahora usa el workspace del blueprint.
- Medio mitigado — `assetOptions` podía derivar linked kit metadata desde kits de otro workspace si existían referencias inconsistentes; ahora el read model exige `kits.workspace_id = assets.workspace_id`.
- Bajo — `foundationReads.getCatalogSnapshot()` aún conserva fallback default para tests/local seed. No usarlo desde IPC sin workspace.

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

**Estado:** Ready for smoke

Objetivo:

Hacer que assign/move sea simple para casos normales y seguro para casos complejos.

Incluye:

- Done — Agregar bandeja operacional persistente en Assets para seleccionar assets a través de múltiples búsquedas.
- Done — La selección visible en tabla ya no borra assets seleccionados fuera del resultado actual.
- Done — Cantidad por defecto = 1 unidad y editable desde la bandeja antes de abrir Assign/Move o Packing.
- Done — `DataTable` soporta `pruneSelectionOnRowsChange=false` sólo para flujos que necesitan selección cross-search.
- Done — Packing usa las mismas cantidades acumuladas en la bandeja.
- Done — Bandeja movida a rail derecho compacto para no empujar la tabla ni romper acceso durante selección bulk.
- Done — Ajuste visual fino: quantity inputs más compactos, zafacones en rojo y rail con scroll usable en pantallas de menor altura.
- Done — Sidebar principal actualizado a panel dark glass con bordes redondeados, manteniendo navegación y resize existentes.
- Done — Patrón reusable de rail derecho redimensionable para Assets, Packing, Asset Detail, RMA, Finance Overview y Sync Outbox; el mínimo conserva el tamaño operativo actual.
- Done — Project Assets ahora reutiliza acciones operativas del cart y abre Packing/Returns desde el contexto del proyecto.
- Done — Assign conserva la selección después de reservar assets y muestra CTA explícito para emitir packing slip sin crear drafts invisibles.
- Done — Disponibilidad unificada de assets compartida por Assets, Assign/Move, Packing y Catalog.
- Done — Reducir copy técnico crítico del panel y reemplazar bloqueos ambiguos por razones accionables.
- Done — Orden progresivo: selección -> modo -> proyecto/unidad/responsable -> cantidad/fechas -> ubicación/notas.
- Done — Mostrar warnings de stock/kit lock y bloquear acciones que perderían cantidad o emitirían assets de kit individualmente.
- Done — Confirmar auditoría en `asset_events` y outbox con tests de assign/packing existentes.
- Done — Hacer que success/error explique qué cambió en operaciones principales.
- Deferred — Multi-incident y multi-RMA desde la bandeja; en este slice quedan acciones single-asset que llevan al contexto correspondiente.

Pruebas:

- Asignar 1 asset.
- Asignar bulk con cantidad parcial.
- Mover asset asignado.
- Intentar operación con permisos insuficientes.
- Simular mala conexión/outbox pending.
- Done — Verificación: `corepack pnpm --filter @bukowski/desktop typecheck`.
- Done — Verificación: `corepack pnpm --filter @bukowski/desktop test -- asset-mutation-service.test.ts packing-mutation-service.test.ts foundation-read-service.test.ts` pasa con 27 archivos/116 tests.
- Done — Verificación: `corepack pnpm --filter @bukowski/desktop build`.
- Done — Verificación 2026-04-29: `corepack pnpm --filter @bukowski/desktop test -- asset-availability.test.ts rma-mutation-service.test.ts incident-mutation-service.test.ts packing-mutation-service.test.ts` pasa con 29 archivos/125 tests.
- Done — Verificación 2026-04-29: `corepack pnpm --filter @bukowski/desktop typecheck` y `corepack pnpm --filter @bukowski/desktop build`.

Findings 2026-04-28:

- Crítico mitigado — El flujo anterior perdía selección al cambiar búsqueda porque `DataTable` podaba selección contra rows visibles. Ahora Assets preserva selección cross-search sin cambiar el default de otras tablas.
- Crítico mitigado — Técnicos podían terminar asignando/packing en pasos repetidos porque sólo podían seleccionar dentro de una búsqueda. La bandeja permite acumular assets, editar cantidades y ejecutar una sola operación.
- Medio mitigado — Assets con stock > 1 ya no toman todo disponible por defecto; la bandeja arranca en 1 unidad para reducir sobre-asignación.
- Medio mitigado — La primera versión de la bandeja crecía arriba de la tabla y hacía difícil seguir buscando/seleccionando. Ahora vive en un rail derecho con scroll propio y el quick preview queda debajo.
- Bajo mitigado — Inputs de cantidad, iconos destructivos y sidebar no estaban visualmente alineados con la densidad/pulido esperado; se ajustaron antes de pasar a Packing.
- Medio mitigado — La disponibilidad se resolvía con reglas dispersas por pantalla. Ahora `assetAvailability.ts` centraliza `Available`, `In kit`, `In repair`, `Retired`, `Checked out`, `Assigned` y `No stock`.
- Medio mitigado — Assign y Packing parecían flujos desconectados. Ahora Assign queda como reserva/staging y el CTA empuja a emitir packing sólo cuando corresponde.
- Medio abierto — Falta smoke manual recreando un packing slip real completo con búsqueda multi-paso, cantidades, export, return, incident y RMA.
- Bajo abierto — Falta revisión visual completa de Packing/Incidents/RMA para aplicar el mismo patrón de rail compacto donde corresponda.

### Slice IC-4 — Packing Slips end-to-end

**Estado:** Doing

Objetivo:

Packing debe sentirse como documento operacional real, no como tabla técnica.

Incluye:

- Builder más corto y progresivo.
- Done — Selección desde Assets alimenta Packing con cantidades acumuladas en el cart.
- Done — Cantidades consistentes con asignaciones, stock disponible y returns.
- Done — Packing bloquea emisión de assets no disponibles usando disponibilidad unificada.
- Done — Insurance workflow pulido: avisos de valores faltantes y export dedicado de insurance list.
- Done — Builder de Packing compactado: ya no repite la lista grande del cart; sólo confirma contexto, warnings y campos del documento.
- Done — Packing detail mueve Export packing slip, Return all pending/selected y Export insurance list al header del card.
- Done — Assets asignados a proyecto pueden alimentar packing desde Project Assets sin volver a buscarlos globalmente.
- Done — Catalog usa rail derecho redimensionable para preview/editor, preservando el menú portal de import/export.
- Doing — PDF/print smoke manual.
- Doing — Return flow claro: parcial, completo, overdue.
- Doing — Estados y colores consistentes.

Pruebas:

- Crear slip desde selección.
- Done — Tests de packing mutation cubren emisión, returns, cantidades parciales, permisos, workspace y kit members.
- Done — Verificación 2026-04-29 incluida en suite de 29 archivos/125 tests.
- Done — Verificación 2026-04-29: `corepack pnpm --filter @bukowski/desktop typecheck`.
- Done — Verificación 2026-04-29: `corepack pnpm --filter @bukowski/desktop build`.
- Done — Verificación 2026-04-29: `corepack pnpm --filter @bukowski/desktop test -- packing-mutation-service.test.ts asset-mutation-service.test.ts asset-availability.test.ts foundation-read-service.test.ts` pasa con 29 archivos/125 tests.
- Todo — Export PDF manual.
- Todo — Export insurance PDF manual.
- Todo — Return parcial manual.
- Todo — Return completo manual.
- Todo — Validar cambios en asset current state en smoke manual.

### Slice IC-5 — Incidents + RMA conectados

**Estado:** Doing

Objetivo:

Que reportar un problema lleve naturalmente a seguimiento, evidencia, costo/RMA si aplica y resolución.

Incluye:

- Done — Incident report más corto y menos técnico.
- Done — Incident detail expone acciones de repair/RMA y retiro cuando aplica.
- Done — Resolución de incident puede retirar assets sin perder historial.
- Done — RMA desde incident/asset mueve assets a maintenance y los saca de disponibilidad.
- Done — RMA puede devolver assets reparados a inventario disponible.
- Done — RMA puede marcar `No repair / retired` y retirar assets.
- Done — RMA list/detail con workspace guard, estados claros y archivos base.
- Done — Asset availability refleja repair/retired en Assets, Assign/Move, Packing y Catalog.
- Done — Localización 2026-05-12 de Incidents/RMA visible sin cambiar valores internos.
- Doing — Evitar duplicar info entre Incident Detail, Asset Detail y RMA Detail.
- Deferred — Traducir/templatar mailto de soporte RMA por idioma del usuario.

Pruebas:

- Reportar incident desde project y desde asset.
- Adjuntar evidencia.
- Done — Tests de incident mutation cubren resolución y retiro de asset.
- Done — Tests de RMA mutation cubren crear repair case, repaired y no repair/retired.
- Done — Verificación 2026-04-29 incluida en suite de 29 archivos/125 tests.
- Done — Verificación 2026-05-12: JSON i18n válido, `corepack pnpm --filter @bukowski/desktop typecheck` y `corepack pnpm --filter @bukowski/desktop build`.
- Todo — Smoke manual: reportar incident desde project y desde asset.
- Todo — Smoke manual: adjuntar evidencia.
- Todo — Smoke manual: crear RMA desde asset/incidente.
- Todo — Smoke manual: cambiar estado de RMA.
- Todo — Smoke manual: resolver incident y confirmar disponibilidad.

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

Volver al **main roadmap** con `Pilot Readiness Hardening` como slice activo.

- Razón: IC-3/IC-4/IC-5 ya tienen lógica, pruebas focalizadas y polish suficiente para no bloquear producto, pero el piloto necesita validar sync, usuarios y permisos con condiciones reales.
- Smoke vertical recomendado queda como checklist antes de demo/release: importar/listar asset -> seleccionar varios assets con cart -> crear packing slip con cantidades -> export packing + insurance -> return parcial/completo -> reportar incident -> crear RMA/repair -> marcar repaired o retired -> confirmar disponibilidad en Assets/Catalog/Packing.
- Precondición si aparece Sync `Pull required`: hacer Pull updates/Refresh antes del smoke para no mezclar cola local vieja con datos cloud más recientes.
- Precondición nueva: `supabase/migrations/20260505130000_operational_snapshots.sql` ya fue aplicada y existe `Backfill operational data` en Sync Activity. Ejecutarlo en el workspace real y confirmar que Sync Activity tiene cobertura reciente para `projects`, `packing_slips`, `incidents` y `rma_cases`.
- Si el smoke falla en Packing, cerrar IC-4 primero.
- Si el smoke falla en Incident/RMA/repair availability, cerrar IC-5 primero.
- Si ambos pasan sin blockers, terminar usuarios operativos mínimos y refactorizar Agents hacia workspace activo antes de Notifications.
