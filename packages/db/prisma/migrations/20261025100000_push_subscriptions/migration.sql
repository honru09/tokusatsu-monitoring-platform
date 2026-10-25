CREATE TABLE "push_subscriptions" (
  "id" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "endpoint" TEXT NOT NULL,
  "p256dh" TEXT NOT NULL,
  "auth" TEXT NOT NULL,
  "user_agent" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "push_subscriptions_endpoint_key"
ON "push_subscriptions"("endpoint");

CREATE INDEX "push_subscriptions_account_id_idx"
ON "push_subscriptions"("account_id");

ALTER TABLE "push_subscriptions"
ADD CONSTRAINT "push_subscriptions_account_id_fkey"
FOREIGN KEY ("account_id") REFERENCES "manager_accounts"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
