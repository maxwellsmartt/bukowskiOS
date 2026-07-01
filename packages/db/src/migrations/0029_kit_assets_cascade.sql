-- Kits Phase 3B: give kit_assets an ON DELETE CASCADE foreign key on kit_id.
-- Cross-machine disband propagates as a sync tombstone whose generic cleanup
-- deletes ONLY the parent kit row; without the cascade, that delete would fail
-- the local FK (kit_assets still referencing the kit). SQLite can't alter a FK
-- in place, so rebuild the table. Nothing references kit_assets (it is a leaf
-- membership table), so this is a straight copy — mirrors the rebuild pattern in
-- 0022_collaborator_payments.sql, no foreign_keys toggle needed.
ALTER TABLE kit_assets RENAME TO kit_assets_legacy;

CREATE TABLE kit_assets (
  kit_id TEXT NOT NULL REFERENCES kits(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id),
  added_at TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (kit_id, asset_id)
);

INSERT INTO kit_assets (kit_id, asset_id, added_at, quantity)
  SELECT kit_id, asset_id, added_at, quantity FROM kit_assets_legacy;

DROP TABLE kit_assets_legacy;
