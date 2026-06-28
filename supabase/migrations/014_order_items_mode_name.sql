-- Migration 014: Add selected_mode_name column to order_items
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS selected_mode_name TEXT;
