-- Migration 0022: collaborator fees and outbound crew payments.
--
-- `invoice_payments` records money received from clients. These tables model
-- money owed and paid out to crew/collaborators.

ALTER TABLE collaborator_fees RENAME TO collaborator_fees_legacy;

CREATE TABLE collaborator_fees (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  crew_member_id TEXT NOT NULL REFERENCES crew_members(id) ON DELETE RESTRICT,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  project_unit_id TEXT REFERENCES project_units(id) ON DELETE SET NULL,
  department_id TEXT REFERENCES departments(id) ON DELETE SET NULL,
  source_assignment_id TEXT REFERENCES project_unit_crew_assignments(id) ON DELETE SET NULL,
  fee_type TEXT NOT NULL,
  description TEXT,
  agreed_amount REAL NOT NULL,
  currency TEXT NOT NULL,
  exchange_rate REAL,
  base_currency_amount REAL,
  paid_amount REAL NOT NULL DEFAULT 0,
  outstanding_amount REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  expected_payment_date TEXT,
  approved_at TEXT,
  cancelled_at TEXT,
  paid_at TEXT,
  created_by_user_id TEXT REFERENCES users(id),
  updated_by_user_id TEXT REFERENCES users(id),
  created_by_actor_type TEXT NOT NULL DEFAULT 'user',
  source_channel TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_collaborator_fees_workspace_status
  ON collaborator_fees(workspace_id, status, expected_payment_date);
CREATE INDEX idx_collaborator_fees_crew
  ON collaborator_fees(workspace_id, crew_member_id, status);
CREATE INDEX idx_collaborator_fees_project
  ON collaborator_fees(workspace_id, project_id, status);
CREATE INDEX idx_collaborator_fees_assignment
  ON collaborator_fees(source_assignment_id);

CREATE TABLE collaborator_payment_batches (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  crew_member_id TEXT NOT NULL REFERENCES crew_members(id) ON DELETE RESTRICT,
  paid_at TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL,
  exchange_rate REAL,
  base_currency_amount REAL,
  payment_method TEXT,
  reference TEXT,
  notes TEXT,
  recorded_by_user_id TEXT REFERENCES users(id),
  created_by_actor_type TEXT NOT NULL DEFAULT 'user',
  source_channel TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_collaborator_payment_batches_workspace_date
  ON collaborator_payment_batches(workspace_id, paid_at DESC);
CREATE INDEX idx_collaborator_payment_batches_crew
  ON collaborator_payment_batches(workspace_id, crew_member_id, paid_at DESC);

CREATE TABLE collaborator_fee_payments (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  fee_id TEXT NOT NULL REFERENCES collaborator_fees(id) ON DELETE CASCADE,
  payment_batch_id TEXT NOT NULL REFERENCES collaborator_payment_batches(id) ON DELETE CASCADE,
  amount REAL NOT NULL,
  currency TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (fee_id, payment_batch_id)
);

CREATE INDEX idx_collaborator_fee_payments_fee
  ON collaborator_fee_payments(fee_id, created_at DESC);
CREATE INDEX idx_collaborator_fee_payments_batch
  ON collaborator_fee_payments(payment_batch_id);

INSERT INTO permissions (id, key, label, description) VALUES
  ('perm-crew-fees-read', 'crew_fees.read', 'Read crew fees', 'View collaborator fees and payment history.'),
  ('perm-crew-fees-manage', 'crew_fees.manage', 'Manage crew fees', 'Create, edit, approve and cancel collaborator fees.'),
  ('perm-crew-payments-record', 'crew_payments.record', 'Record crew payments', 'Record outbound payments to collaborators.')
ON CONFLICT(key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id, created_at)
SELECT roles.id, permissions.id, datetime('now')
FROM roles
JOIN permissions ON permissions.key IN ('crew_fees.read', 'crew_fees.manage', 'crew_payments.record')
WHERE roles.key = 'admin'
ON CONFLICT(role_id, permission_id) DO NOTHING;
