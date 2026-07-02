# macOS Release Flow — BukowskiOS

## Objetivo
Tener dos carriles claros:

1. `internal alpha`
   - firma ad-hoc
   - `deep sign`
   - sin notarization
   - válido para pruebas internas rápidas

2. `release`
   - developer signing real
   - `hardenedRuntime`
   - notarization con Apple
   - stapling de artifacts
   - publicación opcional a GitHub Releases

## Comando oficial de publicación

### Build interno
- `corepack pnpm --filter @bukowski/desktop package:mac`
- `corepack pnpm --filter @bukowski/desktop verify:mac-build`

### Publicar a GitHub Releases
- `corepack pnpm --filter @bukowski/desktop package:mac:release`
- `corepack pnpm --filter @bukowski/desktop release:github`
- Alternativa equivalente dentro de `apps/desktop`: `pnpm release:github`

## Qué hace `release:github`

El script ya deja formalizado el pipeline real de publicación:

1. valida entorno de packaging con `verify:package-env`
2. limpia `dist-packaged`
3. hace build del renderer y Electron
4. recompila módulos nativos con `electron-rebuild`
5. empaqueta macOS con `electron-builder`
6. publica artifacts a GitHub Releases con `--publish always`

Ese es el comando que debemos considerar la fuente de verdad para subir builds de distribución.

## Prerrequisitos de release

### Token de GitHub
- `GH_TOKEN` o `GITHUB_TOKEN`

### Firma de desarrollador
- `CSC_NAME` o `CSC_LINK`
- `CSC_KEY_PASSWORD` si aplica

### Notarization
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`
- `BUKOWSKI_RELEASE_SIGNING=1` para el carril firmado real

## Artifacts esperados

Cuando la publicación sale bien, GitHub Releases debe mostrar por lo menos:

- `.dmg`
- `.zip`

Si el release quedó publicado pero faltan esos archivos, el problema no es del botón in-app: el publish salió incompleto y hay que repetir el empaquetado.

## Comportamiento esperado

### Si no hay credenciales de developer signing
- `release:github` no es el camino recomendado
- usa `package:mac` o `package:internal` para builds internos
- el artifact puede servir para QA local, pero no debe asumirse listo para distribución limpia

### Si hay credenciales de developer signing
- se desactiva el carril ad-hoc
- `electron-builder` usa firma real
- `hardenedRuntime` se activa
- `after-all-artifact-build` intenta notarizar artifacts `.dmg` y `.zip`
- si hay notarization exitosa, intenta `staple`

## Operación recomendada

1. subir el cambio de versión al repo
2. correr `corepack pnpm --filter @bukowski/desktop release:github`
3. validar en GitHub que la release quedó publicada y no como draft accidental
4. confirmar que el tag, el nombre visible y los assets `.dmg` / `.zip` coinciden con la versión
5. probar al menos una descarga limpia del `.dmg`

## Si no hay firma disponible

Si faltan credenciales Apple o no queremos firmar todavía:

- usar `package:mac` para smoke interno rápido
- usar `package:mac:release` solo cuando el entorno de firma/notarización esté listo
- no publicar a GitHub Releases un build que no queramos que el botón `Update` pueda ofrecer luego

## Verificación recomendada

1. Build:
   - `package:mac` para internal
   - `package:mac:release` para release

2. Verificar firma:
   - `verify:mac-build`

3. Smoke manual:
   - instalar el `.dmg` en una Mac arm64 limpia
   - abrir la app
   - verificar que SQLite, preload y arranque funcionan

## Prueba completa del updater in-app

Para validar el flujo sin depender de una release real en GitHub, usa el smoke E2E local:

```bash
VITE_BUKOWSKI_E2E_LOCAL_AUTH=1 corepack pnpm --filter @bukowski/desktop build
corepack pnpm --filter @bukowski/desktop exec playwright test -c playwright.electron.config.ts e2e/smoke/app-update.spec.ts
```

Qué cubre esta prueba:

- levanta un servidor local que simula GitHub Releases
- fuerza una versión actual menor con `BUKOWSKI_UPDATE_CURRENT_VERSION`
- apunta el updater a `BUKOWSKI_UPDATE_RELEASES_URL`
- descarga un `.dmg` falso hacia `BUKOWSKI_UPDATE_DOWNLOADS_DIR`
- valida que aparece el botón `Update`
- valida que el modal muestra progreso y llega a `Descarga completada`
- valida que el archivo final existe y tiene el tamaño esperado
- fuerza auth local con `VITE_BUKOWSKI_E2E_LOCAL_AUTH=1` para que el smoke no dependa de Supabase ni de una sesión real

Estos overrides son solo para pruebas:

- `BUKOWSKI_UPDATE_RELEASES_URL`: URL REST compatible con GitHub Releases
- `BUKOWSKI_UPDATE_RELEASE_PAGE_URL`: fallback opcional para abrir la página de release
- `BUKOWSKI_UPDATE_CURRENT_VERSION`: versión actual simulada
- `BUKOWSKI_UPDATE_DOWNLOADS_DIR`: carpeta temporal donde guardar el instalador

En producción, si estas variables no existen, el app usa GitHub Releases reales y `app.getPath("downloads")`.

## Riesgos abiertos
- Sin credenciales Apple reales no podemos validar notarization end-to-end desde este repo.
- El flujo de GitHub Releases queda listo a nivel de config, pero requiere token y disciplina de versionado/tagging.
- El updater in-app descarga el `.dmg`, pero no ejecuta auto-instalación. Esa decisión es intencional para mantener el flujo simple y auditable.
