# Registro canónico de findings de sync — 2026-06-22

## Propósito

Este documento es la fuente de verdad para los findings de sincronización. Reconciliación realizada contra:

- `sync-pull-inbox-audit-2026-05-24.md`
- `sync-roadmap.md`
- handoffs y roadmaps históricos de Auth/Workspace/Pilot
- implementación y migraciones presentes en `codex/sync-phase1`

Estados permitidos:

- `closed`: implementación terminada y validada en tests/build.
- `accepted`: comportamiento deliberado; el riesgo residual está documentado y no bloquea el modelo actual.
- `open`: falta implementación, infraestructura o validación operativa para cerrar el finding.

`closed` no sustituye un smoke remoto cuando el finding depende de Supabase, Storage, RLS o dos dispositivos reales.

## Resumen

| Estado | Cantidad |
| --- | ---: |
| `closed` | 12 |
| `accepted` | 4 |
| `open` | 4 |

No queda un blocker conocido de implementación local. Sí quedan gates operativos antes de declarar sync validado en producción.

## Findings cerrados

| ID | Severidad original | Finding | Estado | Evidencia |
| --- | --- | --- | --- | --- |
| SYNC-001 | blocker | Finance/Treasury no hidrataba una instalación limpia. | `closed` | `financialDomainPullService`, `useTreasuryPull`, `useCollaboratorPaymentPull`, `useFinanceBusinessPull`; tests de hidratación. |
| SYNC-002 | crítico | Quotes, invoices, payments, finance entries y currency settings podían quedar sólo como log en `sync_outbox`. | `closed` | Materialización por dominio y pull inverso documentados en el audit de 2026-05-24. |
| SYNC-003 | crítico | Snapshots operativos podían avanzar el cursor aunque una fila fallara por dependencias o identidad local. | `closed` | Commits `2ad852da`, `9adebb4e`; apply idempotente, dependencias de catálogo y cursor protegido. |
| SYNC-004 | crítico | Relojes locales podían ordenar mal cambios entre máquinas. | `closed` | Commit `962adee8`; clocks autoritativos de servidor y tolerancia acotada. |
| SYNC-005 | crítico | Deletes no convergían de forma uniforme y podían recrear datos eliminados. | `closed` | Commit `52e22833`; `sync_tombstones`, lifecycle y protección de recreación. |
| SYNC-006 | crítico | Identidades canónicas divergentes causaban `UNIQUE`, referencias faltantes o duplicados. | `closed` | Commit `9adebb4e`; reconciliación de IDs y claves semánticas. |
| SYNC-007 | medio | Catálogos remotos de clients, manufacturers, production companies, departments y crew estaban incompletos. | `closed` | Migrations `20260531120000_catalog_business_entities_sync.sql` y `20260615190000_crew_departments_catalog_sync.sql`; `useCatalogPull` y `catalogPullService`. |
| SYNC-008 | medio | PDFs, imágenes y adjuntos dependían de paths locales y no viajaban entre máquinas. | `closed` | Commits `75519175`, `332f1f7f`, `b6eca11c`; `workspace_files`, Storage privado, outbox, descarga bajo demanda, caché y delete remoto. |
| SYNC-009 | medio | Sync Activity mostraba estados ambiguos o falsos verdes y no distinguía datos stale. | `closed` | Commit `f743568d`; heartbeat, error real, stale a tres minutos y cobertura por workspace. |
| SYNC-010 | medio | La UI mezclaba cursores de varios workspaces. | `closed` | Commit `f743568d`; filtrado de salud/cobertura por workspace activo. |
| SYNC-011 | bajo | `DEFAULT_WORKSPACE_ID` y seeds demo podían contaminar runtime remoto. | `closed` | Commit `60e784d1`; `LOCAL_FALLBACK_WORKSPACE_ID`, demo opt-in en build empaquetada y eliminación del clonado de proyectos demo a workspaces remotos. |
| SYNC-012 | medio | Metadata de archivos podía incluir paths locales en snapshots operativos. | `closed` | Commit `75519175`; sanitización de `storage_path` y `file_url`, tests de no filtración. |

## Riesgos aceptados

| ID | Severidad | Decisión | Estado | Condición de reapertura |
| --- | --- | --- | --- | --- |
| SYNC-013 | medio | Notifications/Inbox y ciertas preferencias siguen cloud-first, con realtime/polling y cache propia, no como tablas SQLite de dominio. | `accepted` | Reabrir si operación offline completa de Inbox se vuelve requisito de negocio. |
| SYNC-014 | medio | Conflictos generales usan server clock/LWW, snapshots completos y guard de outbox local; no existe merge campo-a-campo universal. | `accepted` | Reabrir con un caso reproducible donde dos ediciones válidas pierdan información de negocio. Operaciones sensibles deben seguir bloqueando o generar revisión explícita. |
| SYNC-015 | bajo | Estados bancarios fuente no se replican como archivo; se sincronizan las filas parseadas y auditables. | `accepted` | Reabrir si compliance exige conservar y compartir el documento fuente original. |
| SYNC-016 | bajo | PDFs generados de quotes, invoices y packing slips se regeneran desde datos sincronizados; no son source of truth. | `accepted` | Reabrir si se requiere preservar exactamente el artefacto emitido/firmado. |

## Findings abiertos

| ID | Impacto actual | Finding | Estado | Acción exacta para cerrar |
| --- | --- | --- | --- | --- |
| SYNC-017 | crítico / infra | La migración `20260621203000_workspace_files_foundation.sql` debe estar aplicada en Supabase. | `open` | Aplicar migración; confirmar tabla, policies, grants y bucket privado; abrir un archivo de Mac A en Mac B. |
| SYNC-018 | crítico / operación | Falta smoke end-to-end con dos usuarios y dos instalaciones/build empaquetado. | `open` | Ejecutar matriz A→B y B→A para catálogo, assets, projects, packing, incidents, RMA, Finance/Treasury y archivos; guardar evidencia. |
| SYNC-019 | crítico / seguridad | Falta validar RLS efectiva con usuarios/roles reales después de las últimas migraciones. | `open` | Probar reads/writes permitidos y denegados por rol en Supabase; incluir Finance/Treasury, archivos y agentes/tools. |
| SYNC-020 | medio / producto | Falta UX de revisión sólo para conflictos sensibles reales que no puedan resolverse con LWW/guard de outbox. | `open` | Definir primero casos reales y contrato de conflicto; luego implementar cola/diff por entidad sensible, sin crear un merge genérico prematuro. |

## Fuera del cierre de sync

Estos pendientes aparecen en handoffs cercanos, pero pertenecen a otros tracks y no cuentan como findings de sync:

- OAuth Google/GitHub.
- MFA TOTP.
- notarización/DMG y smoke general de instalación.
- modelo remoto de `workspace_system_actors` y UX general de Agents.
- import wizard CSV, traducciones y polish general de Settings.

Agents/tools sí forman parte de `SYNC-019` cuando la pregunta es autorización efectiva sobre datos sincronizados.

## Gate de cierre operativo

La auditoría de implementación puede darse por cerrada cuando `SYNC-017` esté resuelto. La auditoría operativa completa sólo puede cerrarse cuando `SYNC-018` y `SYNC-019` tengan evidencia. `SYNC-020` puede permanecer abierto como hardening si el smoke no reproduce pérdida de datos por edición concurrente.

## Evidencia de la última fase

- `75519175` — foundation de `workspace_files` y RLS.
- `332f1f7f` — upload/outbox/retries/delete.
- `b6eca11c` — pull, descarga, caché y borrados remotos.
- `f743568d` — estado stale/error/heartbeat por workspace.
- `60e784d1` — aislamiento del fallback local y demo.
- Verificación local: suite completa, typecheck y build pasan al cierre de los slices.
