-- 007_location_images.sql
-- Add image_urls array to locations table

ALTER TABLE locations DROP COLUMN IF EXISTS image_url;
ALTER TABLE locations ADD COLUMN image_urls text[] NOT NULL DEFAULT '{}';
