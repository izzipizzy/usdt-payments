-- Webhooks (merchant notifications) are gone: this is a single-operator wallet service.
DROP TABLE IF EXISTS "webhook_deliveries";
DROP TYPE IF EXISTS "WebhookStatus";
