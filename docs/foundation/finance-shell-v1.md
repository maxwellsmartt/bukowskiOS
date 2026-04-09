# Finance Shell v1

## Objetivo

FinanceOps debe sentirse real desde el inicio, aunque todavia no exista un modulo completo de accounting.

## Lo que si hace en v1

- mostrar exposicion economica de incidentes abiertos
- mostrar valor de reemplazo de assets fuera de almacén
- mostrar proyectos con mayor riesgo operativo-financiero
- mostrar incidentes sin costo estimado
- mostrar un registro inicial de `financial_entries` enlazables

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

## No-goals

- contabilidad completa
- facturacion
- impuestos
- conciliacion bancaria
- reportes fiscales
