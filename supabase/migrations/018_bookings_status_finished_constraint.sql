-- ============================================================
-- 018_bookings_status_finished_constraint.sql
-- Alter bookings table check constraint to support 'finished' and 'completed' statuses.
-- ============================================================

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_status_check CHECK (status IN ('confirmed', 'checked_in', 'finished', 'completed', 'no_show', 'cancelled'));
