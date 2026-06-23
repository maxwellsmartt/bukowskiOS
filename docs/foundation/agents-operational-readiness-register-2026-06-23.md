# Agents operational readiness register - 2026-06-23

Este registro reconcilia el reporte operativo del agente del app contra el código actual. El objetivo es separar huecos reales de falsos positivos creados por trabajo reciente, y dejar un orden de implementación claro para llevar el sistema de agentes a un nivel operativo interno profesional.

## Resumen ejecutivo

El sistema de agentes ya pasó de lectura + drafts a una base operativa real en varios dominios. Los últimos commits cerraron herramientas de escritura y seguridad importantes: proyectos, unidades básicas, incidentes, RMA, quotes guardadas, comunicaciones internas, health/coverage de agentes, approvals exactos y permisos por tool.

Lo que falta no es rehacer la arquitectura. El trabajo correcto es exponer de forma segura motores que ya existen, cerrar lifecycles incompletos y dar trazabilidad/recovery más uniforme.

Validación base:

- `corepack pnpm --filter @bukowski/desktop exec vitest run src/test/agent-tool-registry.test.ts src/test/assistant-gateway-service.test.ts src/test/security-regression.test.ts src/test/communications-send-service.test.ts`
- Resultado: 4 archivos, 57 tests passed.

## Matriz canónica por dominio

| Dominio | Estado | Clasificación | Evidencia | Próximo slice |
|---|---:|---|---|---|
| Seguridad de tools Finance/Treasury | cerrado | Falso positivo del reporte / doc stale | `agentToolRegistry` declara `requiredPermission`, `assistantGatewayService` carga permisos confiables, tests bloquean usuarios sin `finance.read` / `treasury.transactions.read`. | Actualizar docs stale y mantener test de regresión. |
| Proyectos | cerrado parcial | Core operativo cubierto | Tools existentes: `create_project`, `update_project`; backend también cubre archive/unarchive/delete. | No agregar más tools hasta tener caso operativo claro para archive/delete desde agente. |
| Units / scheduling | parcial | Missing real agent-facing | Existe `create_project_unit`; backend cubre update/delete units. | Exponer `update_project_unit` y `delete_project_unit` con `projects.manage` + approval. |
| Assets / inventario | parcial | Missing real agent-facing | Backend existe para `createAsset`, `updateAsset`, `archiveAsset`, `assignMoveAssets`, receipts y `asset_events`; agente hoy sólo lee, busca, crea packing y returns. | Exponer `create_asset`, `update_asset`, `archive_asset`, `assign_move_assets`. |
| Incidents / repairs / RMA | mayormente cerrado | Core operativo cubierto | Tools existentes: `create_incident`, `update_incident`, `create_rma`, `assess_repair_or_replace`; reads de timeline, estimates, maintenance queue e historial. | Dejar `close_incident` como alias futuro sólo si UX lo necesita; hoy `update_incident` con `status='Resolved'` cierra. |
| Finance / quotes | parcial | Lifecycle seguro incompleto | Tools existentes: `create_quote`, `set_quote_status`, reads de quotes y finance; permisos protegidos. | Agregar sólo `update_quote_draft` / `create_invoice_from_quote` si el backend actual los soporta sin bypass de permisos. |
| Communications | cerrado para v1 interno | Core operativo cubierto | Tools existentes: `list_recipients`, `preview_send_targets`, `draft_message`, `send_message`; `communications.send` y approval humano. | No abrir email/WhatsApp/clientes externos en este v1. |
| Todos / reminders | parcial | Missing real lifecycle | Tools existentes crean intents: `create_todo`, `create_reminder`; UI ya tiene acciones humanas. | Agregar `list_todos`, `complete_todo`, `update_reminder`, `cancel_reminder`. |
| Approval / governance | cerrado base, optimización abierta | Core seguro cubierto | `get_pending_approvals`, approval payloads exactos, `approve_for_session`, hashes SHA-256, permissions al aprobar. | Mejorar reporting unificado, no cambiar la frontera de seguridad. |
| Auditoría operativa unificada | abierto | Missing real platform | Hay receipts, runs, approvals, events y timelines dispersos. | Agregar `get_action_history` read-only con payload compacto y permisos sensibles. |
| Recovery UX | abierto | Hardening real | Hay mejoras puntuales en asset miss y permission request; los errores siguen heterogéneos entre tools. | Normalizar mensajes: campo faltante, acción sugerida, retry seguro y alternativa. |

## Findings reconciliados

| ID | Severidad | Finding original | Estado | Decisión |
|---|---:|---|---|---|
| AGENT-001 | crítico | Finance/Treasury tools podían saltarse permisos de usuario. | closed | Cerrado por `requiredPermission`, permisos confiables en gateway y tests de bloqueo. |
| AGENT-002 | alto | Falta lifecycle de assets desde agentes. | open | Backend existe; exponer tools approval-required sobre `assetMutationService`. |
| AGENT-003 | alto | Falta update/delete de unidades desde agentes. | open | Backend existe; exponer tools sobre `projectMutationService`. |
| AGENT-004 | alto | Incidents no cierran ciclo. | closed | `update_incident` puede cerrar con status, `create_rma` y decision support cubren reparación. |
| AGENT-005 | medio | Quotes eran sólo drafts no operativos. | partial | `create_quote` y `set_quote_status` existen; falta edición segura de draft/invoice handoff si backend lo permite. |
| AGENT-006 | medio | Communications sólo preparaba mensajes. | closed for v1 | `send_message` entrega in-app y Telegram enlazado con approval y permiso dedicado. |
| AGENT-007 | medio | Todos/reminders no tienen gestión completa. | open | Crear ciclo mínimo list/complete/update/cancel. |
| AGENT-008 | medio | No hay action history unificado. | open | Consolidar runs, approvals, receipts y eventos en `get_action_history`. |
| AGENT-009 | medio | Recovery de errores no es suficientemente guiado. | open | Estandarizar errores tool-facing. |
| AGENT-010 | bajo | Bulk actions generales faltan. | accepted | Para v1, sólo usar bulk donde el backend ya existe y es auditable: `assignMoveAssets` y treasury rules. Bulk universal queda fuera por riesgo. |
| AGENT-011 | bajo | Workflows largos/state machines completos faltan. | accepted | No meter state machine genérica ahora. Se prefiere lifecycles concretos por dominio y auditoría antes de orquestación compleja. |
| AGENT-012 | bajo | Canales externos comerciales faltan. | accepted | Email/WhatsApp/clientes externos, billing/cobros y envío comercial quedan fuera del v1 interno. |

## Orden recomendado de implementación

1. Asset write tools, porque desbloquean operación real sobre inventario sin crear backend nuevo.
2. Project unit update/delete, porque completa scheduling básico con bajo riesgo técnico.
3. Todos/reminders lifecycle, porque cierra el loop de seguimiento operacional.
4. Finance lifecycle seguro, limitado a capacidades backend ya existentes.
5. `get_action_history`, porque convierte receipts/eventos dispersos en trazabilidad usable por agentes.
6. Recovery UX, para que errores y datos faltantes sean claros para usuarios no técnicos.

## Criterio de cierre

El track de agentes internos puede darse por cerrado cuando:

- Cada write tool nuevo sea approval-required.
- Cada write/read sensible declare `requiredPermission`.
- El agente reciba sólo tools permitidas por allowlist y permisos del usuario.
- Cada slice tenga tests focalizados y `typecheck`.
- Cada mutación deje recibo/evento auditable o reutilice uno existente.
- El registro canónico quede actualizado con `closed`, `partial`, `open` o `accepted`.
