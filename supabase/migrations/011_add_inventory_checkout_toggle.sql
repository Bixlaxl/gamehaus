-- Migration: Add show_at_checkout boolean column to inventory_items table
ALTER TABLE public.inventory_items 
ADD COLUMN IF NOT EXISTS show_at_checkout BOOLEAN NOT NULL DEFAULT FALSE;

-- Index for fast lookup on public checkout page
CREATE INDEX IF NOT EXISTS idx_inventory_items_show_at_checkout 
ON public.inventory_items (location_id, show_at_checkout) 
WHERE show_at_checkout = TRUE AND is_active = TRUE;
