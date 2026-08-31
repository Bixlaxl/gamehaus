-- Migration: Add show_in_tab_app boolean column to inventory_items table
-- Defaults to FALSE so existing items are opt-in (owner explicitly enables per item).
ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS show_in_tab_app BOOLEAN NOT NULL DEFAULT FALSE;

-- Index for fast lookup on the tablet beverages endpoint
CREATE INDEX IF NOT EXISTS idx_inventory_items_show_in_tab_app
  ON public.inventory_items (location_id, show_in_tab_app)
  WHERE show_in_tab_app = TRUE AND is_active = TRUE;
