# Visual Fidelity Audit — bukowskiOS

> Single-source reference for the visual hardening pass shipped with Sprint 2 (auditoría G7).

## Surfaces audited

| Surface | Glass | Grain | Notes |
|---|---|---|---|
| Shell sidebar | `--blur-lg` + saturate(1.14) | ✅ `--grain-opacity-sidebar` (0.04) | SVG turbulence pseudo-element. |
| Window titlebar | None | ✅ `--grain-opacity-titlebar` (0.025) | Drag region preserved. |
| Top context bar | None | None | Sólido — high-frequency reads (search, sync). |
| Subnav tabs | None | None | Sólido. |
| Breadcrumb | None | None | Sin fondo desde A1. |
| `SurfaceCard` | None (default) | None | Sólido para legibilidad. |
| `ConfirmDialog` | `--blur-md` | None | Modales ligeros. |
| `OnboardingTour` backdrop | `--blur-sm` | None | Hero modal con animación entrada. |
| `WorkspaceSwitcher` menu | None (sólido) | None | Crítica para legibilidad de role/avatar. |
| `HelpMenu` popover | None | None | Sólido. |
| `GlobalAssistantChat` panel | `--blur-md` | None | Pulled left rail puede llevar glass. |
| `DataTable` | None | None | Sólido obligatorio. Lectura densa. |
| Forms / inputs | None | None | Sólido. |
| Logs (`SyncOutboxPage`) | None | None | Sólido — debugging requiere claridad. |
| `Toast` | `--blur-xs` | None | Pop-overs efímeros. |

## Tokens centralizados

Ver `apps/desktop/src/shared/styles/tokens.css`. Categorías:

- **Hairlines**: `--hairline-faint`, `--hairline`, `--hairline-strong`. Aliases legacy: `--border-subtle`, `--border-strong`.
- **Radius**: scale `--radius-2xs / xs / sm / md / lg / xl / pill`. Aliases: `--radius-panel`, `--radius-control`.
- **Shadows**: `--shadow-soft`, `--shadow-elevated`, `--shadow-modal`.
- **Glass**: `--blur-xs / sm / md / lg`.
- **Type**: `--font-2xs … --font-2xl`, `--weight-regular / medium / semibold / bold`.
- **Layout**: `--shell-content-max: 1680px`, `--sidebar-width-min/max`, `--row-height`.
- **Breakpoints (advisory)**: `--bp-compact: 1280px`, `--bp-standard: 2559px`. >= 2560px = large.
- **Grain**: `--grain-opacity-sidebar`, `--grain-opacity-titlebar`, `--grain-blend-mode`.

## Responsive strategy

- **No magic media queries para sidebar**: `.app-shell` usa `--sidebar-width: clamp(var(--sidebar-width-min), 18vw, var(--sidebar-width-max))`. En 4K+ (`min-width: 2560px`) sube a 288px.
- **Content max-width**: `.shell-content > *:not(.shell-content-fullbleed)` se centra a `max-width: var(--shell-content-max)` para evitar stretching en 4K. Páginas que necesiten todo el ancho añaden la clase `shell-content-fullbleed`.
- **Settings layout**: `.settings-shell-layout` con `grid-template-columns: clamp(180px, 22vw, 240px) minmax(0, 1fr)`.

## Retina / sharpness fixes

- Eliminado `transform: translateX(1px)` en `.shell-nav-link.active` — causaba sub-pixel rendering del texto. Reemplazado por contraste de borde con `--hairline-strong`.
- Hairlines normalizados a `var(--hairline*)` donde se aplicó la migración (consumers core).
- `OnboardingTour` y `WorkspaceSwitcher` con animaciones `transform` solo durante transición; reposo sin transform.

## Glass selectivo — reglas

- **Aplicar glass**: shell sidebar, modales, popovers efímeros, panel de chat, top-of-stack overlays.
- **Mantener sólido**: DataTable, formularios, logs, code blocks, cualquier surface con lectura densa de texto largo.
- **Nunca apilar** dos surfaces glass adyacentes sin un sólido en medio (rompe legibilidad).

## Grain — reglas

- Solo en `.shell-sidebar` y `.window-titlebar`. SVG con `feTurbulence baseFrequency=0.85, numOctaves=2`.
- `mix-blend-mode: overlay` con opacidad muy baja (`0.04` y `0.025` respectivamente).
- Pseudo-element `::before` con `pointer-events: none; z-index: 0`. Children del surface se elevan a `z-index: 1`.
- **No aplicar** a tablas, formularios, logs, contenido denso.

## Asset audit

| Asset | Variantes | Estado |
|---|---|---|
| `bukowskiOS_logo_white.png` | 1x, 2x | Hardening 3x diferido (no bloqueante; SVG sería ideal). |
| Lucide icons | Vector | ✅ Vector siempre. |
| Connector brand PNGs | 1x | OK como raster auditado — no son UI icons funcionales. |

## Validación visual

Pantallas que deben verificarse en cada release de fidelity:
- Overview, Assets list, Asset detail, Projects, Project detail, Timeline, Agents/Mission Control, Chat panel, Settings (todas las sub-pages), Modal/dialog states.

Resoluciones:
- 1080p (compact)
- 1440p (standard)
- 4K (large)
- Retina built-in si está disponible

Criterios de aceptación:
- Sin overflow mayor en compact.
- Sin whitespace excesivo en large (max-width centra).
- Glass legible y consistente con la regla de selectividad.
- DataTable readable y siempre sólido.
- Chat FAB y compare tray coexisten sin solape.
- Grain visible pero no compite con el contenido.
- Sin assets raster nuevos en UI funcional.

## Migrations futuras (no bloqueantes)

- Reemplazo masivo de hardcodes restantes por tokens (radius, shadow, font sizes/weights). Plan: por componente, no big-bang.
- SVG variantes 3x del logo principal cuando el UX team dé asset.
- `density toggle` (compact / cozy / comfortable) en `DataTable`.
