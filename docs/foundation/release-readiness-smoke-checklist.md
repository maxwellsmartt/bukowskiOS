# BukowskiOS — Internal alpha smoke checklist

## Objetivo
Validar que el app desktop sigue arrancando, navegando y exponiendo superficies críticas después de cambios de hardening, UI o data layer.

## Smoke automatizado
Comando:

```bash
corepack pnpm --filter @bukowski/desktop test:e2e
```

Cobertura actual:
- arranque del shell sin white screen
- navegación principal visible
- Mission Control carga
- Runs carga
- Settings carga y muestra acciones críticas

## Smoke manual mínimo

### 1. Arranque
- abrir el app
- confirmar que no hay pantalla en blanco
- confirmar que el sidebar carga con `Assets`, `Finance`, `Agents`

### 2. Settings
- abrir `Settings`
- correr `Run integrity check`
- correr `Create backup now`
- probar `Export all data as JSON`

### 3. Agents
- abrir `Mission Control`
- abrir `Runs`
- si hay approvals pendientes:
  - `Approve`
  - `Approve for this session`
  - `Deny`

### 4. Operación
- crear o editar un incident
- resolver un incident
- hacer assign/move de varios assets
- crear o editar una finance entry

### 5. Packaging macOS
- abrir `.dmg` en una Mac arm64 limpia
- mover la app a `Applications`
- abrirla dos veces para confirmar comportamiento de instancia
- verificar que no hay error de firma ad-hoc en instalación interna
- registrar resultado en `docs/foundation/macos-arm64-smoke-evidence-v1.md`

## Evidencia local disponible
- build interno y verificación local de firma ya documentados en:
  - `docs/foundation/macos-arm64-smoke-evidence-v1.md`
- estado actual:
  - `codesign` OK
  - `spctl` falla como esperado en internal alpha no notarizada
  - falta smoke manual en Mac arm64 limpia

## Criterios de salida
- sin white screen
- sin crash en arranque
- sin regresiones visibles en navegación crítica
- Settings operativa
- flujos básicos de operación intactos

## Riesgos que este smoke no cubre
- performance con datasets muy grandes
- sync remoto
- multi-workspace real
- notarization pública
