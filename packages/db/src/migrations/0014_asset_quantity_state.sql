ALTER TABLE asset_current_state
ADD COLUMN total_quantity INTEGER NOT NULL DEFAULT 1;

ALTER TABLE asset_current_state
ADD COLUMN available_quantity INTEGER NOT NULL DEFAULT 1;

ALTER TABLE asset_current_state
ADD COLUMN assigned_quantity INTEGER NOT NULL DEFAULT 0;

ALTER TABLE asset_current_state
ADD COLUMN checked_out_quantity INTEGER NOT NULL DEFAULT 0;

ALTER TABLE packing_slip_items
ADD COLUMN source_flow TEXT NOT NULL DEFAULT 'available';
