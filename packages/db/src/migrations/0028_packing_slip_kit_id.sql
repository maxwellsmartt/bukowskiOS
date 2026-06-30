-- Kits Phase 2: tag packing slip items with the kit they were issued as part of,
-- so the slip (screen + PDF) can render kit members as a grouped package instead
-- of loose equipment. Nullable: loose items keep NULL.
ALTER TABLE packing_slip_items ADD COLUMN source_kit_id TEXT REFERENCES kits(id);

CREATE INDEX IF NOT EXISTS idx_packing_slip_items_kit
  ON packing_slip_items(source_kit_id);
