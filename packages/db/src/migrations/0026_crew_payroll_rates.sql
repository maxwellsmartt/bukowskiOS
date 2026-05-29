-- Migration 0026: crew payroll foundation — pay rates + permissions.
--
-- Adds default pay rates to crew_members and per-assignment overrides to
-- project_unit_crew_assignments. Seeds the full Payroll permission set so later
-- sub-phases (timesheets, vouchers) don't each need a permissions migration.
-- Money stays REAL + 2dp, consistent with the rest of the app.

ALTER TABLE crew_members ADD COLUMN default_daily_rate REAL;
ALTER TABLE crew_members ADD COLUMN default_weekly_rate REAL;
ALTER TABLE crew_members ADD COLUMN default_overtime_rate REAL;
ALTER TABLE crew_members ADD COLUMN rate_currency TEXT;

ALTER TABLE project_unit_crew_assignments ADD COLUMN daily_rate_override REAL;
ALTER TABLE project_unit_crew_assignments ADD COLUMN weekly_rate_override REAL;
ALTER TABLE project_unit_crew_assignments ADD COLUMN overtime_rate_override REAL;
ALTER TABLE project_unit_crew_assignments ADD COLUMN rate_notes TEXT;

INSERT INTO permissions (id, key, label, description) VALUES
  ('perm-crew-read-rates', 'crew.read_rates', 'Read crew rates', 'View crew default pay rates and assignment overrides.'),
  ('perm-crew-edit-rates', 'crew.edit_rates', 'Edit crew rates', 'Set crew default pay rates and assignment overrides.'),
  ('perm-crew-timesheets-read', 'crew.timesheets.read', 'Read crew timesheets', 'View crew timesheets and computed gross amounts.'),
  ('perm-crew-timesheets-write', 'crew.timesheets.write', 'Write crew timesheets', 'Record and edit crew timesheets.'),
  ('perm-crew-vouchers-read', 'crew.vouchers.read', 'Read crew vouchers', 'View crew payment vouchers and history.'),
  ('perm-crew-vouchers-issue', 'crew.vouchers.issue', 'Issue crew vouchers', 'Issue crew payment vouchers with retentions.'),
  ('perm-crew-vouchers-cancel', 'crew.vouchers.cancel', 'Cancel crew vouchers', 'Cancel crew payment vouchers.'),
  ('perm-crew-vouchers-export', 'crew.vouchers.export', 'Export crew vouchers', 'Export crew payment voucher PDFs.')
ON CONFLICT(key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id, created_at)
SELECT roles.id, permissions.id, datetime('now')
FROM roles
JOIN permissions ON permissions.key IN (
  'crew.read_rates', 'crew.edit_rates',
  'crew.timesheets.read', 'crew.timesheets.write',
  'crew.vouchers.read', 'crew.vouchers.issue', 'crew.vouchers.cancel', 'crew.vouchers.export'
)
WHERE roles.key = 'admin'
ON CONFLICT(role_id, permission_id) DO NOTHING;
