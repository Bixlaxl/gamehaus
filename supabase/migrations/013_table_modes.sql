-- Migration 013: Add dynamic table modes column to tables table
ALTER TABLE public.tables
ADD COLUMN IF NOT EXISTS modes JSONB DEFAULT '[]'::jsonb;
