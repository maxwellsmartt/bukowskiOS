# BukowskiOS — macOS arm64 smoke evidence v1

## Fecha
- 2026-04-12

## Objetivo
- dejar evidencia reproducible del carril `internal alpha` en macOS arm64
- separar claramente lo que ya quedó validado en esta máquina de lo que todavía requiere smoke manual en una Mac limpia

## Evidencia local confirmada

### Build y artefactos
- comando corrido:

```bash
corepack pnpm --filter @bukowski/desktop package:mac
```

- artefactos presentes:
  - `apps/desktop/dist-packaged/mac-arm64/bukowskiOS.app`
  - `apps/desktop/dist-packaged/bukowskiOS-0.1.0-arm64.zip`
  - `apps/desktop/dist-packaged/bukowskiOS-0.1.0-arm64.dmg`

- timestamps observados:
  - `bukowskiOS.app`: `2026-04-12 17:38:31`
  - `bukowskiOS-0.1.0-arm64.zip`: `2026-04-12 17:38:59`
  - `bukowskiOS-0.1.0-arm64.dmg`: `2026-04-12 13:48:26`

### Firma
- comando corrido:

```bash
corepack pnpm --filter @bukowski/desktop verify:mac-build
```

- resultado:
  - `codesign --verify --deep --strict` pasa para `apps/desktop/dist-packaged/mac-arm64/bukowskiOS.app`
  - `spctl` falla, lo cual es esperado para un build **internal alpha** con firma `ad-hoc` y sin notarization

- verificación adicional:

```bash
codesign --verify --deep --strict apps/desktop/dist-packaged/mac-arm64/bukowskiOS.app
```

- resultado:
  - `VERIFIED`

## Qué sí queda cerrado con esta evidencia
- el carril `internal alpha` sigue empaquetando en arm64
- la app empaquetada sigue quedando firmada con `ad-hoc + deep sign`
- la verificación local de `codesign` sigue pasando
- el fallo de `spctl` sigue documentado como esperado mientras no exista notarization real

## Qué todavía falta y no puede darse por cerrado desde este entorno
- smoke del `.dmg` en una **Mac arm64 limpia**
- mover la app a `Applications`
- abrir la app instalada manualmente
- abrirla dos veces para confirmar `single instance lock`
- correr smoke mínimo de:
  - `Settings`
  - backup
  - integrity check
  - export JSON
  - sync queue
- validar que no aparezca error de instalación fuera del entorno actual

## Riesgos remanentes
- `medio`: el artefacto `.dmg` presente no quedó con timestamp nuevo en esta pasada; el `.app` y el `.zip` sí quedaron frescos. Conviene regenerar y abrir el `.dmg` durante el smoke manual limpio para cerrar ese punto sin ambigüedad.
- `medio`: `spctl` seguirá fallando mientras el build siga en carril `internal alpha` no notarizado.
- `bajo`: la evidencia local confirma packaging y firma, pero no sustituye la validación de UX/instalación en máquina limpia.

## Criterio para marcar el smoke arm64 como completamente cerrado
- ejecutar el checklist manual en una Mac arm64 limpia
- adjuntar fecha, máquina y resultado
- confirmar apertura, navegación base y flujos críticos sin white screen ni errores de instalación
