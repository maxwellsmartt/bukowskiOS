# Local Dev Guide

Guia corta para arrancar, validar y probar el foundation shell actual de bukowskiOS.

## Estado actual del proyecto

Hoy bukowskiOS ya tiene:

- repo modular
- shell desktop Electron + React
- navegacion base aprobada
- Assets shell
- Finance shell visible y estructuralmente real
- schema foundation local
- SQLite local conectada al shell
- seed demo local para workspace, assets, incidents, packing y finance shell
- import legacy de Rentman montado automaticamente sobre el registro de assets

Todavia no tiene:

- auth real
- sync real
- tablas remotas finales en Supabase
- command pipeline de writes reales
- operaciones productivas de inventory

## Prerequisitos

- Node.js 22+
- macOS o entorno con soporte para abrir Electron
- acceso a terminal dentro del repo

Si no tienes `pnpm` instalado globalmente, usa `corepack pnpm` en todos los comandos.

## Bootstrap local

Desde la raiz del repo:

```bash
corepack pnpm install
```

## Comandos base

```bash
corepack pnpm dev
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm verify
```

Si ya tienes `pnpm` global:

```bash
pnpm dev
pnpm verify
```

## Que hace cada comando

- `dev`: levanta Vite + Electron para el shell desktop
- `typecheck`: valida TypeScript
- `test`: corre tests focalizados del foundation
- `build`: genera build del renderer y de Electron main/preload
- `verify`: corre typecheck + tests + build

## Smoke run recomendado

1. Corre:

```bash
corepack pnpm dev
```

2. Verifica manualmente que abra la app y que veas:
- sidebar con `Overview`, `Assets`, `Finance`
- top context bar
- subnav de Assets
- pantalla `Finance` con overview, cost links y entries
- ventana abierta maximizada
- resize libre respetando limites minimos

3. Navega al menos por:
- `Overview`
- `Assets`
- `Asset Detail`
- `Packing Slips`
- `Incidents`
- `Projects`
- `Finance Overview`
- `Finance Cost Links`
- `Finance Entries`

4. Confirma que los datos ya no son solo mocks sueltos:
- `Overview` muestra metricas cargadas
- `Assets` muestra el registry desde SQLite con el inventario legacy ya montado
- `Asset Detail` abre timeline e incidentes del asset
- `Packing Slips`, `Incidents`, `Projects`, `Catalog` y `Finance` responden con datos seed reales

## Que debes probar manualmente ahora

- que la ventana abra sin crash
- que abra maximizada desde el primer launch
- que puedas redimensionarla y moverla sin perder estabilidad
- que la navegacion lateral marque estado activo
- que el subnav cambie entre Assets y Finance
- que el top context bar permanezca estable
- que el shell se sienta dark, sobrio y con densidad media
- que Finance no se vea como placeholder vacio
- que `Asset Detail` cargue al entrar desde la lista
- que no aparezcan errores de IPC al navegar

## Que no necesitas hacer todavia

No necesitas aun:

- correr SQL en Supabase para usar el shell actual
- configurar auth
- crear buckets reales
- conectar base de datos remota
- sembrar datos manualmente

La carpeta `supabase/` hoy existe para fijar ownership y preparar el siguiente slice. La migracion remota actual es solo placeholder.

## SQLite local actual

- La app crea una base local en:

```text
/Users/ernestooffice2/Library/Application Support/@bukowski/desktop/bukowski-foundation.sqlite
```

- En el primer arranque, la app:
  - ejecuta la migracion foundation
  - siembra un workspace demo
  - siembra assets, incidents, packing slips, projects y finance entries de prueba
  - monta el export legacy de Rentman dentro del registro de assets

- El archivo fuente del import legacy hoy vive en:

```text
/Users/ernestooffice2/Dev/bukowskiOS/packages/db/src/seeds/legacy-rentman-20211015.csv
```

- Si quieres resetear el seed local, cierra la app, borra ese archivo `.sqlite` y vuelve a correr `corepack pnpm dev`.

## Warning esperado en terminal

Durante `dev` puedes ver este warning:

```text
ExperimentalWarning: SQLite is an experimental feature
```

Hoy esto no esta rompiendo el runtime ni el build.

Impacto: `medio`

Porque:
- para foundation y testing local nos simplifica mucho el stack
- pero sigue siendo una API experimental del runtime

Salida estructural si esto molesta luego:
- migrar a un driver estable como `better-sqlite3` cuando entremos a hardening del runtime local

## Siguiente paso manual recomendado

Si quieres dejar Supabase pre-listo antes del siguiente slice, lo minimo seria:

1. Crear el proyecto de Supabase si aun no existe.
2. Guardar URL y keys del proyecto para cuando introduzcamos `.env`.
3. No ejecutar aun schema remoto definitivo, porque en este foundation solo esta cerrado el modelo local y el bridge conceptual.

## Resultado esperado hoy

Si todo sale bien, debes poder:

- instalar dependencias
- correr `dev`
- ver la app abrir
- ver datos reales desde SQLite en el shell
- correr `verify` sin errores

## Ledger de comandos iniciales

```bash
corepack pnpm install
corepack pnpm verify
corepack pnpm dev
```

## Notas de troubleshooting

- Si `pnpm` no existe: usa `corepack pnpm ...`
- Si Electron no abre: corre de nuevo `corepack pnpm install`
- Si el puerto 5173 esta ocupado, Vite puede moverse a otro puerto automaticamente
- Si algo falla en build, revisar primero `apps/desktop/vite.config.ts`
- Si abre pero se ve raro en pantallas pequenas, revisar `apps/desktop/src/shared/styles/global.css`
- Si quieres reiniciar el estado demo local, borrar el archivo `bukowski-foundation.sqlite`
