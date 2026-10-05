PRAGMA foreign_keys = ON;
CREATE TABLE users (telegram_id TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE stores (id TEXT PRIMARY KEY, settings TEXT NOT NULL CHECK(json_valid(settings)), version INTEGER NOT NULL DEFAULT 1 CHECK(version>0));
CREATE TABLE webhook_events (event_key TEXT PRIMARY KEY, provider TEXT NOT NULL DEFAULT '', order_id TEXT, payment_status TEXT, amount_kopecks INTEGER, proof_hash TEXT, received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE orders (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(telegram_id), request_key TEXT NOT NULL, request_hash TEXT NOT NULL,
 store_id TEXT NOT NULL REFERENCES stores(id), status TEXT NOT NULL CHECK(status IN ('WAITING_CONFIRMATION','CONFIRMED','PAYMENT_PENDING','PAID','SENT_TO_STORE','IN_PRODUCTION','READY','COMPLETED','COURIER_ORDERED','COURIER_PICKED_UP','DELIVERED','CANCELLED','REFUND_PENDING','REFUNDED','EXPIRED_UNCLAIMED')),
 total_kopecks INTEGER NOT NULL CHECK(total_kopecks>0), data TEXT NOT NULL CHECK(json_valid(data)), version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 paid_event_key TEXT REFERENCES webhook_events(event_key), hold_until TEXT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(user_id,request_key)
);
CREATE INDEX orders_user_created ON orders(user_id,created_at DESC,id DESC);
CREATE INDEX orders_created ON orders(created_at DESC,id DESC);
CREATE INDEX orders_status_created ON orders(status,created_at DESC);
CREATE INDEX orders_expiry ON orders(hold_until) WHERE status IN ('READY','COURIER_ORDERED');
CREATE TABLE order_events (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL REFERENCES orders(id), actor TEXT NOT NULL, previous_status TEXT, status TEXT NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE INDEX order_events_order ON order_events(order_id,id);
CREATE TABLE payments (order_id TEXT PRIMARY KEY REFERENCES orders(id), request_id TEXT NOT NULL UNIQUE, status TEXT NOT NULL, url TEXT NOT NULL DEFAULT '', request_body TEXT NOT NULL CHECK(json_valid(request_body)), created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, dedupe_key TEXT NOT NULL UNIQUE, chat_id TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)), attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), lease_until TEXT, lease_token TEXT, delivered_at TEXT, failed_at TEXT, last_error TEXT);
CREATE INDEX notifications_pending ON notifications(next_attempt_at) WHERE delivered_at IS NULL AND failed_at IS NULL;
CREATE TABLE audit_events (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT NOT NULL, action TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at TEXT NOT NULL);
CREATE INDEX rate_limits_expiry ON rate_limits(expires_at);
-- An optimistic precondition failure aborts the entire native D1 batch.
-- Every successful batch deletes its transient guard; there is no growing lock table.
CREATE TABLE mutation_guards (id TEXT PRIMARY KEY, ok INTEGER NOT NULL CONSTRAINT mutation_precondition CHECK(ok=1));

-- Retained for compatibility with an eventual PostgreSQL data export. D1 itself uses d1_migrations.
CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
