-- ============================================================
-- 005_performance_indexes.sql
-- Performance indexes to optimize hot query paths and table joins
-- ============================================================

-- Optimize location filters
CREATE INDEX IF NOT EXISTS idx_orders_location_status ON orders(location_id, status);
CREATE INDEX IF NOT EXISTS idx_tables_location ON tables(location_id, is_active);

-- Optimize order-item joins (hot path)
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_table_id ON order_items(table_id);
CREATE INDEX IF NOT EXISTS idx_order_items_status ON order_items(status);

-- Optimize booking joins & range queries (today's bookings)
CREATE INDEX IF NOT EXISTS idx_bookings_order_id ON bookings(order_id);
CREATE INDEX IF NOT EXISTS idx_bookings_order_item_id ON bookings(order_item_id);
CREATE INDEX IF NOT EXISTS idx_bookings_scheduled_start ON bookings(scheduled_start, status);

-- Optimize payments joins
CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments(order_id);
