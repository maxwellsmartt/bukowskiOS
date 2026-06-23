# Agents operational readiness register - 2026-06-23

Este registro reconcilia el reporte operativo del agente del app contra el código actual. El objetivo es separar huecos reales de falsos positivos creados por trabajo reciente, y dejar un orden de implementación claro para llevar el sistema de agentes a un nivel operativo interno profesional.

## Resumen ejecutivo

El sistema de agentes ya pasó de lectura + drafts a una base operativa interna real. Los últimos commits cerraron herramientas de escritura y seguridad importantes: proyectos, unidades, assets, incidents, RMA, quote/invoice lifecycle seguro, todos/reminders, comunicaciones internas, health/coverage de agentes, approvals exactos, permisos por tool, historial operacional unificado y recovery de errores tool-facing.

No hace falta rehacer la arquitectura para el v1 interno. El trabajo pendiente relevante queda en v2: canales externos comerciales, billing/cobros reales y workflows genéricos de larga duración.

Validación base:

- `corepack pnpm --filter @bukowski/desktop exec vitest run src/test/agent-tool-registry.test.ts`
- `corepack pnpm --filter @bukowski/desktop exec vitest run src/test/foundation-read-service.test.ts src/test/assistant-gateway-service.test.ts src/test/security-regression.test.ts`
- `corepack pnpm --filter @bukowski/desktop typecheck`
- Resultado reciente: registry `16 tests` passed; foundation/gateway/security `54 tests` passed; typecheck passed.

## Matriz canónica por dominio

| Dominio | Estado | Clasificación | Evidencia | Próximo slice |
|---|---:|---|---|---|
| Seguridad de tools Finance/Treasury | cerrado | Falso positivo del reporte / doc stale | `agentToolRegistry` declara `requiredPermission`, `assistantGatewayService` carga permisos confiables, tests bloquean usuarios sin `finance.read` / `treasury.transactions.read`. | Actualizar docs stale y mantener test de regresión. |
| Proyectos | cerrado parcial | Core operativo cubierto | Tools existentes: `create_project`, `update_project`; backend también cubre archive/unarchive/delete. | No agregar más tools hasta tener caso operativo claro para archive/delete desde agente. |
| Units / scheduling | cerrado | Lifecycle agent-facing cubierto | `create_project_unit`, `update_project_unit`, `delete_project_unit`; `projects.manage`; approval-required; tests de update/delete y payload. | Mantener archive/delete de proyecto fuera hasta caso operativo claro. |
| Assets / inventario | cerrado | Lifecycle agent-facing cubierto | `create_asset`, `update_asset`, `archive_asset`, `assign_move_assets`; `assets.manage`; approval-required; receipts y `asset_events`; tests de registry/permissions/receipts. | Bulk universal queda fuera; sólo bulk auditado sobre `assignMoveAssets`. |
| Incidents / repairs / RMA | mayormente cerrado | Core operativo cubierto | Tools existentes: `create_incident`, `update_incident`, `create_rma`, `assess_repair_or_replace`; reads de timeline, estimates, maintenance queue e historial. | Dejar `close_incident` como alias futuro sólo si UX lo necesita; hoy `update_incident` con `status='Resolved'` cierra. |
| Finance / quotes | cerrado para v1 interno | Lifecycle seguro cubierto | `create_quote`, `update_quote_draft`, `set_quote_status`, `create_invoice_from_quote`; permisos `finance.manage` / `invoices.create`; immutable status protegido. | Envíos externos, cobros y full billing quedan v2. |
| Communications | cerrado para v1 interno | Core operativo cubierto | Tools existentes: `list_recipients`, `preview_send_targets`, `draft_message`, `send_message`; `communications.send` y approval humano. | No abrir email/WhatsApp/clientes externos en este v1. |
| Todos / reminders | cerrado | Lifecycle mínimo cubierto | `create_todo`, `create_reminder`, `list_todos`, `complete_todo`, `update_reminder`, `cancel_reminder`; scope workspace/user. | Automatizaciones complejas quedan v2. |
| Approval / governance | cerrado base, optimización abierta | Core seguro cubierto | `get_pending_approvals`, approval payloads exactos, `approve_for_session`, hashes SHA-256, permissions al aprobar. | Mejorar reporting unificado, no cambiar la frontera de seguridad. |
| Auditoría operativa unificada | cerrado | Platform read-only cubierto | `get_action_history` consolida agent runs, approvals, command receipts, asset events, incidents, packing, quote/invoice status y communications; finanzas sólo con permisos. | Expandir con más dominios si aparecen motores nuevos. |
| Recovery UX | cerrado base | Hardening tool-facing cubierto | Registry valida JSON/required fields y normaliza errores de stale ID, transición inválida, unique constraint y blockers con acción sugerida/retry. | Pulir copy por dominio cuando haya feedback real de uso. |

## Findings reconciliados

| ID | Severidad | Finding original | Estado | Decisión |
|---|---:|---|---|---|
| AGENT-001 | crítico | Finance/Treasury tools podían saltarse permisos de usuario. | closed | Cerrado por `requiredPermission`, permisos confiables en gateway y tests de bloqueo. |
| AGENT-002 | alto | Falta lifecycle de assets desde agentes. | closed | Cerrado con `create_asset`, `update_asset`, `archive_asset`, `assign_move_assets`; approval-required y `assets.manage`. |
| AGENT-003 | alto | Falta update/delete de unidades desde agentes. | closed | Cerrado con `update_project_unit` y `delete_project_unit`; approval-required y `projects.manage`. |
| AGENT-004 | alto | Incidents no cierran ciclo. | closed | `update_incident` puede cerrar con status, `create_rma` y decision support cubren reparación. |
| AGENT-005 | medio | Quotes eran sólo drafts no operativos. | closed for v1 | `create_quote`, `update_quote_draft`, `set_quote_status` y `create_invoice_from_quote` cubren lifecycle interno seguro. |
| AGENT-006 | medio | Communications sólo preparaba mensajes. | closed for v1 | `send_message` entrega in-app y Telegram enlazado con approval y permiso dedicado. |
| AGENT-007 | medio | Todos/reminders no tienen gestión completa. | closed | Cerrado con ciclo mínimo list/complete/update/cancel por workspace/user scope. |
| AGENT-008 | medio | No hay action history unificado. | closed | Cerrado con `get_action_history`, payload compacto y gating de datos financieros. |
| AGENT-009 | medio | Recovery de errores no es suficientemente guiado. | closed base | Cerrado en registry con errores accionables para JSON inválido, required fields, stale IDs, transiciones inválidas, unique constraints y blockers. |
| AGENT-010 | bajo | Bulk actions generales faltan. | accepted | Para v1, sólo usar bulk donde el backend ya existe y es auditable: `assignMoveAssets` y treasury rules. Bulk universal queda fuera por riesgo. |
| AGENT-011 | bajo | Workflows largos/state machines completos faltan. | accepted | No meter state machine genérica ahora. Se prefiere lifecycles concretos por dominio y auditoría antes de orquestación compleja. |
| AGENT-012 | bajo | Canales externos comerciales faltan. | accepted | Email/WhatsApp/clientes externos, billing/cobros y envío comercial quedan fuera del v1 interno. |

## Orden recomendado de implementación

1. Cerrado: asset write tools sobre backend existente.
2. Cerrado: project unit update/delete.
3. Cerrado: todos/reminders lifecycle mínimo.
4. Cerrado: finance lifecycle seguro limitado a backend estable.
5. Cerrado: `get_action_history` read-only.
6. Cerrado base: recovery UX para errores tool-facing.

Orden recomendado siguiente para v2:

1. Email/WhatsApp/clientes externos con sandbox, allowlists, logs y opt-in explícito.
2. Billing/cobros reales con doble aprobación y pruebas de idempotencia.
3. Workflows largos/state machine por dominio sólo donde haya casos reales repetidos.

## Criterio de cierre

El track de agentes internos v1 puede darse por cerrado cuando:

- Cada write tool nuevo sea approval-required.
- Cada write/read sensible declare `requiredPermission`.
- El agente reciba sólo tools permitidas por allowlist y permisos del usuario.
- Cada slice tenga tests focalizados y `typecheck`.
- Cada mutación deje recibo/evento auditable o reutilice uno existente.
- El registro canónico quede actualizado con `closed`, `partial`, `open` o `accepted`.

Estado al 2026-06-23: cumplido para el alcance v1 interno. Los items aceptados de v2 quedan fuera deliberadamente para evitar over-engineering y riesgo operativo prematuro.
