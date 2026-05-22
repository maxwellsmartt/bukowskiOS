# Finance Shell v1

Ultima revision: `2026-05-22`

Estado actual: este documento describe la base original de FinanceOps. La
implementacion actual ya avanzo mas alla del shell inicial: existen
cotizaciones, facturas, NCF, pagos de facturas, PDFs y settings fiscales. Para
la auditoria consolidada de lo faltante, ver
`docs/foundation/finance-settings-audit-consolidated-v1.md`.

## Objetivo

FinanceOps debe sentirse real desde el inicio, aunque todavia no exista un modulo completo de accounting.

## Lo que si hacia el shell inicial

- mostrar exposicion economica de incidentes abiertos
- mostrar valor de reemplazo de assets fuera de almacén
- mostrar proyectos con mayor riesgo operativo-financiero
- mostrar incidentes sin costo estimado
- mostrar un registro inicial de `financial_entries` enlazables

## Lo que ya hace el producto actual

- crear y editar `financial_entries` con idempotencia y sync outbox
- adjuntar documentos financieros
- crear cotizaciones con versiones auditables y PDF
- generar facturas desde cotizaciones o manualmente
- emitir facturas con consumo atomico de NCF
- registrar pagos recibidos contra facturas
- configurar moneda, ITBIS, Sirecine, tasas y NCF desde Settings

## Lo que aun falta

- honorarios de tecnicos/colaboradores como modulo propio
- pagos salientes a colaboradores
- historial de pagos por colaborador, proyecto y unit
- permisos dedicados para aprobar y registrar pagos a crew
- reportes de cuentas por pagar

## Vistas base

- `Finance Overview`
- `Cost Links`
- `Entries`

## Regla de producto

FinanceOps no duplica la fuente de verdad de AssetOps. Lee contexto economico desde:

- `assets.replacement_value`
- `incidents.cost_estimate`
- `incidents.financial_status`
- `financial_entries`

## No-goals del shell inicial

- contabilidad completa
- conciliacion bancaria
- reportes fiscales

Nota: facturacion, NCF e ITBIS ya no son no-goals; fueron implementados despues
del shell inicial.
