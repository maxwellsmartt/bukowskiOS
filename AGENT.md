# AGENT.md

Manual operativo para Codex dentro de bukowskiOS.

## 1. Principios base

- Priorizar estabilidad, seguridad, consistencia e idempotencia antes que features nuevos.
- Hacer el cambio mas pequeno y seguro que complete la tarea.
- Explicar impacto real y riesgos en lenguaje claro.
- Si algo afecta arquitectura, UX, persistencia, eventos o sync, pausar y confirmar.
- Pensar siempre en mala conexion, retries, usuarios no tecnicos y recovery.

## 2. Mapa real del repo

- App desktop: `apps/desktop`
- Main process: `apps/desktop/electron/main`
- Preload/IPC: `apps/desktop/electron/preload`
- Renderer: `apps/desktop/src`
- Dominio compartido: `packages/domain`
- Contratos tipados: `packages/contracts`
- DB, migraciones y proyecciones: `packages/db`
- Sync y outbox: `packages/sync`
- Sistema visual: `packages/ui`
- Supabase: `supabase`
- ADRs y foundation docs: `docs/`

## 3. Fuentes de verdad

- La verdad historica operativa vive en `asset_events`.
- El estado actual vive en proyecciones como `asset_current_state`.
- Ninguna pantalla debe inferir historia solo desde estado actual.
- El renderer no accede directo a SQLite, filesystem ni Supabase.
- Todo write entra por command handlers tipados via IPC.
- Sync no reemplaza la persistencia local; la complementa.

## 4. Reglas antes de editar

- Identificar si el cambio toca UI, dominio, DB, proyecciones, IPC, sync o storage.
- Listar archivos a tocar.
- Describir estrategia corta.
- Si cambia schema, payload o flujo operativo, razonar migracion y compatibilidad.

## 5. Reglas de implementacion

- Mantener servicios pequenos por dominio.
- Mantener hooks pequenos por responsabilidad.
- No meter logica de negocio en componentes.
- No crear archivos `App`, `page`, `service` o `utils` gigantes.
- Toda accion importante debe dejar evento auditable.
- Las correcciones se hacen con eventos compensatorios, no borrando historia.
- Adjuntos, uploads y sync deben soportar retry y errores visibles.

## 6. Red flags reales

- No mezclar identidad de asset con estado actual en la misma tabla mental.
- No usar `users.workspace_id` como solucion multi-tenant final; usar memberships.
- No tratar `asset_assignments` como historial completo; el historial completo vive en eventos.
- No permitir que la UI “arregle” estados sin generar evento.
- No declarar sync como saludable si hay outbox pendiente o errores de retry.
- No esconder fallos de uploads o adjuntos detras de estados optimistas silenciosos.

## 7. Disciplina anti-monolito

- Cada feature vive en su carpeta.
- Los imports entre features deben pasar por contratos publicos, no por internals.
- Si un archivo crece demasiado, extraer antes de seguir agregando logica.
- `shared` no es cajon de sastre; solo primitives, tokens y helpers realmente transversales.

## 8. Validacion minima

- UI: tests focalizados y smoke del shell desktop.
- Dominio/DB: tests de invariantes de eventos y proyecciones.
- Persistencia/sync: tests de retry, idempotencia y recovery.
- Si cambia schema: migracion + compatibilidad hacia atras razonada.
- Si cambia IPC: validar preload + main + renderer.

## 9. Reglas de debugging

- Decir que archivo mirar.
- Decir que funcion revisar.
- Decir que log agregar.
- Decir que tabla o payload inspeccionar.
- Decir que test cubre la regresion.

## 10. Prohibido sin aprobacion explicita

- Bypass de IPC desde renderer.
- Escrituras directas a cloud desde componentes.
- Refactors grandes no pedidos.
- Dependencias nuevas sin justificar.
- Borrado de historia operativa.
- Cambios de arquitectura o UX sin confirmacion.

## 11. Higiene documental

- Si cambia arquitectura real, schema, IPC, sync o flujos operativos, actualizar `README.md` y/o `AGENT.md`.
- `README.md` explica el sistema a humanos.
- `AGENT.md` define reglas operativas para Codex.
