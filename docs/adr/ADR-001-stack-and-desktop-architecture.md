# ADR-001: Stack and Desktop Architecture

Status: Accepted

## Context

bukowskiOS nace como app operativa interna, desktop-first, con necesidad de resiliencia local, futura sync multi-device y crecimiento hacia producto distribuible.

## Decision

- Usar Electron como shell desktop.
- Usar React + TypeScript + Vite en renderer.
- Mantener SQLite en el main process como store operativa local.
- Usar Supabase para auth, Postgres cloud, storage de adjuntos y backbone de sync futuro.
- Exponer capacidades por preload/IPC tipado; el renderer no toca IO directo.
- Organizar el repo como workspace modular dentro de un repo standalone.

## Why

- Desktop local resuelve mejor mala conexion, operaciones de almacen y uso interno continuo.
- SQLite da trazabilidad y velocidad local sin depender de red.
- Supabase deja lista la capa cloud para usuarios, storage y sync sin forzar cloud-first.
- IPC tipado reduce acoplamiento y riesgo de seguridad.
- Workspace modular previene god-files y separa dominio, DB, sync y UI.

## Consequences

- Hay que mantener migraciones locales y cloud.
- La consistencia entre eventos, proyecciones y outbox se vuelve parte del core.
- El empaquetado debe contemplar dependencias nativas y acceso seguro a filesystem.
- Movil y agentes futuros consumiran los mismos contratos de dominio, no logica duplicada.
