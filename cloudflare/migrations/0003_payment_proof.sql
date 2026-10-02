-- Defence in depth: only a persisted, verified webhook proof can produce PAID.
CREATE TRIGGER paid_requires_webhook_update BEFORE UPDATE OF status ON orders
WHEN NEW.status='PAID' AND OLD.status<>'PAID'
BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM webhook_events e WHERE e.event_key=NEW.paid_event_key AND e.provider='yandex-pay' AND e.order_id=NEW.id AND e.payment_status='CAPTURED' AND e.amount_kopecks=NEW.total_kopecks AND length(e.proof_hash)=64) THEN RAISE(ABORT,'PAID_REQUIRES_VERIFIED_WEBHOOK') END;
END;
CREATE TRIGGER paid_requires_webhook_insert BEFORE INSERT ON orders WHEN NEW.status='PAID'
BEGIN
 SELECT RAISE(ABORT,'NEW_ORDER_MUST_NOT_BE_PAID');
END;
