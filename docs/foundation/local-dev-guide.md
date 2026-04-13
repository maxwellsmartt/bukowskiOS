# Local Dev Guide

Guia corta para arrancar, validar, empaquetar y retomar trabajo local de bukowskiOS, incluyendo una Mac nueva o una computadora de oficina que todavia no tenga toolchain ni dependencias instaladas.

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

- macOS con soporte para abrir Electron
- Node.js 22+
- acceso a terminal dentro del repo

Si no tienes `pnpm` instalado globalmente, usa `corepack pnpm` en todos los comandos.

## Setup en una Mac nueva o limpia

Este repo usa Electron + `better-sqlite3`, asi que una maquina nueva necesita toolchain nativo ademas de Node.

### 1. Instalar Xcode Command Line Tools

```bash
xcode-select --install
```

Riesgo si falta: `critico`

Impacto real:
- `pnpm install` puede fallar compilando modulos nativos
- `electron-rebuild` puede romperse al reconstruir `better-sqlite3`

### 2. Instalar Homebrew si la Mac no lo tiene

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

### 3. Instalar Node 22

```bash
brew install node@22
brew link --overwrite node@22
```

### 4. Activar Corepack

```bash
corepack enable
corepack prepare pnpm@10.8.1 --activate
```

### 5. Verificar toolchain minimo

```bash
node -v
corepack pnpm -v
```

Esperado:
- Node `22.x`
- pnpm `10.8.1`

## Bootstrap local del repo

Con el repo ya clonado, desde la raiz:

```bash
corepack pnpm install
```

Esto instala dependencias del workspace y deja lista la base para correr dev, tests y packaging.

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

## Comandos de empaquetado

Para una Mac de trabajo o de oficina, estos son los comandos utiles para generar artefactos instalables y validar que quedaron bien:

### Build interno para pruebas locales

```bash
corepack pnpm --filter @bukowski/desktop package:mac
```

Esto:
- corre `build`
- reconstruye `better-sqlite3` contra Electron
- genera app empaquetada para macOS sin publicacion

### Verificar firma y bundle generado

```bash
corepack pnpm --filter @bukowski/desktop verify:mac-build
```

### Build release firmado

Usar solo si la maquina ya tiene credenciales Apple configuradas:

```bash
corepack pnpm --filter @bukowski/desktop package:mac:release
```

### Publicacion a GitHub Releases

Usar solo si la maquina ya tiene credenciales Apple y token de GitHub:

```bash
corepack pnpm --filter @bukowski/desktop release:github
```

### Artefactos esperados

Despues de `package:mac`, los artefactos quedan en:

```text
apps/desktop/dist-packaged/
```

Ejemplos tipicos:
- `apps/desktop/dist-packaged/mac-arm64/bukowskiOS.app`
- `apps/desktop/dist-packaged/bukowskiOS-0.1.0-arm64.dmg`
- `apps/desktop/dist-packaged/bukowskiOS-0.1.0-arm64.zip`

Si necesitas mas detalle del flujo de signing/notarization, revisar [`docs/foundation/macos-release-flow.md`](/Users/ernestomaxwell/Dev/bukowskiOS/docs/foundation/macos-release-flow.md).

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
$HOME/Library/Application Support/@bukowski/desktop/bukowski-foundation.sqlite
```

- En el primer arranque, la app:
  - ejecuta la migracion foundation
  - siembra un workspace demo
  - siembra assets, incidents, packing slips, projects y finance entries de prueba
  - monta el export legacy de Rentman dentro del registro de assets

- El archivo fuente del import legacy hoy vive en:

```text
<repo>/packages/db/src/seeds/legacy-rentman-20211015.csv
```

- Si quieres resetear el seed local, cierra la app, borra la base local `.sqlite` y vuelve a correr `corepack pnpm dev`.

## Warning posible en terminal

Normalmente el runtime local usa `better-sqlite3` primero.

Si ese modulo nativo falla en una maquina nueva, la app puede intentar fallback a `node:sqlite`. En ese escenario podrias ver un warning relacionado con SQLite experimental.

Impacto: `medio`

Impacto real:
- la app puede seguir levantando
- pero ese warning suele indicar que el entorno local no quedo del todo sano
- si despues quieres empaquetar, conviene corregir primero el build nativo

Fix rapido:
- correr `corepack pnpm --filter @bukowski/desktop rebuild:electron`
- si sigue fallando, reinstalar dependencias con `corepack pnpm install`

Fix estructural:
- mantener `better-sqlite3` sano en cada maquina de desarrollo y usar el fallback solo como red de seguridad, no como flujo principal

## Siguiente paso manual recomendado

Si quieres dejar Supabase pre-listo antes del siguiente slice, lo minimo seria:

1. Crear el proyecto de Supabase si aun no existe.
2. Guardar URL y keys del proyecto para cuando introduzcamos `.env`.
3. No ejecutar aun schema remoto definitivo, porque en este foundation solo esta cerrado el modelo local y el bridge conceptual.

## Resultado esperado hoy

Si todo sale bien, debes poder:

- instalar toolchain base en una Mac limpia
- instalar dependencias del repo
- correr `dev`
- ver la app abrir
- ver datos reales desde SQLite en el shell
- correr `verify` sin errores
- generar un `.dmg` local con `package:mac`

## Ledger de comandos iniciales

```bash
xcode-select --install
brew install node@22
corepack enable
corepack prepare pnpm@10.8.1 --activate
corepack pnpm install
corepack pnpm verify
corepack pnpm dev
corepack pnpm --filter @bukowski/desktop package:mac
corepack pnpm --filter @bukowski/desktop verify:mac-build
```

## Notas de troubleshooting

- Si `pnpm` no existe: usa `corepack pnpm ...`
- Si `node` no existe: instala `node@22` y corre de nuevo `corepack enable`
- Si `pnpm install` falla compilando modulos nativos: corre `xcode-select --install` y luego `corepack pnpm install`
- Si Electron no abre despues de instalar en una maquina nueva: corre `corepack pnpm --filter @bukowski/desktop rebuild:electron`
- Si el packaging falla despues de cambiar de maquina o version de Node: corre `corepack pnpm --filter @bukowski/desktop rebuild:electron` y luego repite `package:mac`
- Si ves warnings de SQLite experimental en una Mac nueva: asume primero que fallo `better-sqlite3` y revisa el paso de `rebuild:electron`
- Si el puerto 5173 esta ocupado, Vite puede moverse a otro puerto automaticamente
- Si algo falla en build, revisar primero `apps/desktop/vite.config.ts`
- Si abre pero se ve raro en pantallas pequenas, revisar `apps/desktop/src/shared/styles/global.css`
- Si quieres reiniciar el estado demo local, borrar el archivo `bukowski-foundation.sqlite`
