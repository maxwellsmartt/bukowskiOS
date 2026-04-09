# Next Slices v1

Mapa de ejecucion recomendado despues del detour visual y de shell.

## Slice 01 - Runtime local real

Objetivo:
- conectar SQLite real al main process
- ejecutar `0001_foundation.sql`
- exponer un servicio minimo de bootstrap local

Salida esperada:
- DB local creada al abrir la app
- migracion foundation aplicada automaticamente
- logs claros si algo falla

Archivos probables:
- `apps/desktop/electron/main/services/*`
- `packages/db/src/sqlite/*`
- `packages/db/src/migrations/0001_foundation.sql`

## Slice 02 - Seed and demo workspace

Objetivo:
- cargar un workspace demo local
- seed minimo de projects, departments, locations, categories y assets

Salida esperada:
- el shell deja de depender de mock data dura en renderer
- las listas leen desde queries reales

## Slice 03 - Assets list + detail conectados

Objetivo:
- reemplazar sample data por queries reales
- leer `assets`, `asset_current_state` y timeline de `asset_events`

Salida esperada:
- `Assets`
- `Asset Detail`
- `Overview` con data local real

## Slice 04 - First command pipeline

Objetivo:
- introducir un primer write real por command handler
- sugerido: `create asset` o `move asset`

Salida esperada:
- write via IPC
- transaccion local
- evento creado
- proyeccion actualizada
- receipt local persistido

## Slice 05 - Incident reporting foundation

Objetivo:
- formulario corto real
- persistencia de incidente
- linkage con asset / project / department
- reflejo en FinanceOps `Cost Links`

Salida esperada:
- primer puente real entre AssetOps y FinanceOps

## Slice 06 - Packing slips foundation

Objetivo:
- crear packing slip
- asociar assets disponibles
- emitir slip

Salida esperada:
- documento operativo real
- cambio de estado visible en assets
- base para retornos parciales

## Slice 07 - Hardening local

Objetivo:
- logs utiles
- errores visibles
- recovery basico
- smoke tests mas robustos

Salida esperada:
- app mas facil de debuggear
- menos deuda antes de sync/auth cloud

## Slice 08 - Supabase bridge real

Objetivo:
- introducir `.env`
- conectar proyecto Supabase
- definir primer bridge real de auth/storage/sync readiness

Nota:
- este slice no debe hacerse antes de cerrar bien la base local.

## Orden recomendado

1. Runtime local real
2. Seed and demo workspace
3. Assets list + detail conectados
4. First command pipeline
5. Incident reporting foundation
6. Packing slips foundation
7. Hardening local
8. Supabase bridge real

## Criterio de control

No pasar al siguiente slice si el actual no deja:

- build limpio
- smoke run sano
- paths de debugging claros
- testing focalizado minimo
