# Schema v1

## Acceso y tenancy

- `workspaces(id, slug unique, name, base_currency, is_active, created_at, updated_at)`
- `users(id, full_name, email unique, phone, is_active, created_at, updated_at)`
- `workspace_memberships(id, workspace_id fk, user_id fk, role_id fk, status, joined_at, created_at, unique(workspace_id,user_id))`
- `roles(id, workspace_id fk, key, name, description, is_system_role, created_at, unique(workspace_id,key))`
- `permissions(id, key unique, label, description)`
- `role_permissions(role_id fk, permission_id fk, created_at, unique(role_id,permission_id))`

## Catalogo operativo

- `departments(id, workspace_id fk, code, name, description, is_active, created_at, unique(workspace_id,code))`
- `projects(id, workspace_id fk, code, name, client_name, status, start_date, end_date, description, created_at, updated_at, unique(workspace_id,code))`
- `locations(id, workspace_id fk, code, name, type, description, is_active, created_at, unique(workspace_id,code))`
- `asset_categories(id, workspace_id fk, parent_category_id fk nullable, code, name, description, created_at, unique(workspace_id,code))`

## Registro de assets

- `assets(id, workspace_id fk, category_id fk, name, brand, model, serial_number, internal_code, description, purchase_date, purchase_price, currency, replacement_value, current_book_value, ownership_type, default_location_id fk, qr_code_value, notes, is_active, created_at, updated_at, unique(workspace_id,internal_code))`
- `asset_files(id, asset_id fk, file_type, file_url, external_url, label, uploaded_by_user_id fk, created_at)`

## Estado actual y movimientos

- `asset_current_state(asset_id pk fk, workspace_id fk, current_location_id fk, current_project_id fk nullable, current_department_id fk nullable, current_responsible_user_id fk nullable, active_assignment_id fk nullable, condition_status, operational_status, custody_status, last_event_id fk, version, updated_at)`
- `asset_assignments(id, workspace_id fk, asset_id fk, project_id fk nullable, department_id fk nullable, assigned_to_user_id fk nullable, assigned_by_user_id fk, source_location_id fk nullable, target_location_id fk nullable, assignment_status, checked_out_at, expected_return_at, returned_at, notes, created_at, updated_at)`
- `asset_events(id, workspace_id fk, asset_id fk, assignment_id fk nullable, project_id fk nullable, department_id fk nullable, performed_by_user_id fk, event_type, location_id fk nullable, from_location_id fk nullable, to_location_id fk nullable, event_timestamp, command_id, actor_type, source_channel, notes, metadata_json, created_at, index(workspace_id,asset_id,event_timestamp))`

## Documentos operativos

- `packing_slips(id, workspace_id fk, project_id fk, department_id fk nullable, prepared_by_user_id fk, approved_by_user_id fk nullable, responsible_user_id fk nullable, status, issue_date, return_due_date, notes, created_at, updated_at)`
- `packing_slip_items(id, packing_slip_id fk, asset_id fk, quantity default 1, condition_out, condition_in, returned_at, notes, unique(packing_slip_id,asset_id))`

## Incidentes

- `incidents(id, workspace_id fk, asset_id fk nullable, project_id fk nullable, department_id fk nullable, assignment_id fk nullable, reported_by_user_id fk, incident_type, severity, status, title, description, reported_at, resolved_at, responsible_user_id fk nullable, cost_estimate, currency, financial_status, notes, created_at, updated_at)`
- `incident_files(id, incident_id fk, file_url, file_type, uploaded_by_user_id fk, created_at)`

## Hooks financieros

- `financial_entries(id, workspace_id fk, entry_type, category, amount, currency, exchange_rate, base_currency_amount, status, project_id fk nullable, asset_id fk nullable, incident_id fk nullable, created_by_user_id fk, entry_date, description, notes, created_at, updated_at)`
- `collaborator_fees(id, workspace_id fk, user_id fk, project_id fk nullable, department_id fk nullable, fee_type, agreed_amount, currency, status, notes, created_at)`

Estado actual `2026-05-22`:

- `financial_entries` si tiene servicio, UI, documentos, idempotencia y outbox.
- `collaborator_fees` sigue siendo placeholder de schema local: no tiene
  contratos, servicios, UI, Supabase/RLS ni sync productivo. No debe tratarse
  como feature implementada hasta completar el modulo de honorarios/pagos a
  colaboradores.
- Los pagos implementados hoy viven en `invoice_payments` y representan cobros
  recibidos contra facturas de clientes, no pagos salientes a tecnicos.

## Plataforma y sync

- `command_receipts(command_id pk, workspace_id fk, actor_user_id fk nullable, actor_type, source_channel, executed_at, outcome_status, error_message nullable)`
- `sync_outbox(id, workspace_id fk, entity_type, entity_id, event_id fk nullable, operation_type, payload_json, status, attempt_count, last_error nullable, next_retry_at nullable, created_at, updated_at, index(status,next_retry_at))`

## Invariantes base

- Todo write operativo crea evento.
- `asset_current_state.last_event_id` siempre apunta al ultimo evento aplicado.
- No se elimina historia operativa; solo se archiva o compensa.
- `financial_entries` no bloquea v1, pero la columna puente existe desde el inicio.
