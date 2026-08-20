-- ============================================================
-- 017_tournament_registrations.sql
-- Tournament registrations table, indexes, and RLS policies
-- ============================================================

CREATE TABLE IF NOT EXISTS tournament_registrations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 400,
  status TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('paid', 'unpaid')),
  payment_id TEXT,
  razorpay_order_id TEXT,
  payment_method TEXT NOT NULL DEFAULT 'razorpay',
  pass_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance & rapid query lookups
CREATE INDEX IF NOT EXISTS idx_tournament_registrations_created_at ON tournament_registrations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tournament_registrations_phone ON tournament_registrations(phone);
CREATE INDEX IF NOT EXISTS idx_tournament_registrations_payment_id ON tournament_registrations(payment_id);
CREATE INDEX IF NOT EXISTS idx_tournament_registrations_razorpay_order_id ON tournament_registrations(razorpay_order_id);
CREATE INDEX IF NOT EXISTS idx_tournament_registrations_status ON tournament_registrations(status);
CREATE INDEX IF NOT EXISTS idx_tournament_registrations_pass_id ON tournament_registrations(pass_id);

-- Enable RLS
ALTER TABLE tournament_registrations ENABLE ROW LEVEL SECURITY;

-- Allow public read of registrations count/data
CREATE POLICY "Allow public read access to tournament registrations"
  ON tournament_registrations
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Allow service role / admin full access
CREATE POLICY "Allow service role full access to tournament registrations"
  ON tournament_registrations
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
