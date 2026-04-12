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

## Scripts disponibles

### Internal builds
- `corepack pnpm --filter @bukowski/desktop package:mac`
- `corepack pnpm --filter @bukowski/desktop verify:mac-build`

### Release builds
- `corepack pnpm --filter @bukowski/desktop package:mac:release`
- `corepack pnpm --filter @bukowski/desktop release:github`

## Variables requeridas para release signing

### Firma de desarrollador
- `CSC_NAME` o `CSC_LINK`
- `CSC_KEY_PASSWORD` si aplica

### Notarization
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

### Publicación opcional
- `GH_TOKEN` o `GITHUB_TOKEN`

## Comportamiento esperado

### Si no hay credenciales de developer signing
- el hook `after-sign` usa firma ad-hoc
- `spctl` puede fallar
- el build sigue siendo válido para pruebas internas

### Si hay credenciales de developer signing
- se desactiva el carril ad-hoc
- `electron-builder` usa firma real
- `hardenedRuntime` se activa
- `after-all-artifact-build` intenta notarizar artifacts `.dmg` y `.zip`
- si hay notarization exitosa, intenta `staple`

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

## Riesgos abiertos
- Sin credenciales Apple reales no podemos validar notarization end-to-end desde este repo.
- El flujo de GitHub Releases queda listo a nivel de config, pero requiere token y disciplina de versionado/tagging.
- `auto-update` todavía no está activado en runtime; este documento deja la base de build/publicación, no el updater completo.
