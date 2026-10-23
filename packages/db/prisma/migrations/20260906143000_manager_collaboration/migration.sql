CREATE TABLE "manager_accounts" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "display_name" TEXT NOT NULL,
  "avatar_initial" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "manager_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "direct_messages" (
  "id" TEXT NOT NULL,
  "sender_id" TEXT NOT NULL,
  "recipient_id" TEXT NOT NULL,
  "text" TEXT,
  "item_id" TEXT,
  "reply_to_id" TEXT,
  "forwarded_from_id" TEXT,
  "read_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "direct_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "direct_messages_has_content" CHECK (
    length(btrim(COALESCE("text", ''))) > 0 OR "item_id" IS NOT NULL
  ),
  CONSTRAINT "direct_messages_distinct_participants" CHECK ("sender_id" <> "recipient_id")
);

CREATE TABLE "message_reactions" (
  "id" TEXT NOT NULL,
  "message_id" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "reaction" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "message_reactions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "message_reactions_allowed" CHECK ("reaction" IN ('heart', 'agree', 'check'))
);

CREATE UNIQUE INDEX "manager_accounts_key_key" ON "manager_accounts"("key");
CREATE UNIQUE INDEX "manager_accounts_position_key" ON "manager_accounts"("position");
CREATE INDEX "manager_accounts_active_position_idx" ON "manager_accounts"("active", "position");
CREATE INDEX "direct_messages_sender_id_created_at_idx" ON "direct_messages"("sender_id", "created_at");
CREATE INDEX "direct_messages_recipient_id_read_at_created_at_idx" ON "direct_messages"("recipient_id", "read_at", "created_at");
CREATE INDEX "direct_messages_item_id_idx" ON "direct_messages"("item_id");
CREATE INDEX "direct_messages_reply_to_id_idx" ON "direct_messages"("reply_to_id");
CREATE INDEX "direct_messages_forwarded_from_id_idx" ON "direct_messages"("forwarded_from_id");
CREATE INDEX "direct_messages_created_at_id_idx" ON "direct_messages"("created_at", "id");
CREATE UNIQUE INDEX "message_reactions_message_id_account_id_reaction_key" ON "message_reactions"("message_id", "account_id", "reaction");
CREATE INDEX "message_reactions_account_id_created_at_idx" ON "message_reactions"("account_id", "created_at");

ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_sender_id_fkey"
  FOREIGN KEY ("sender_id") REFERENCES "manager_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_recipient_id_fkey"
  FOREIGN KEY ("recipient_id") REFERENCES "manager_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_item_id_fkey"
  FOREIGN KEY ("item_id") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_reply_to_id_fkey"
  FOREIGN KEY ("reply_to_id") REFERENCES "direct_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_forwarded_from_id_fkey"
  FOREIGN KEY ("forwarded_from_id") REFERENCES "direct_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_message_id_fkey"
  FOREIGN KEY ("message_id") REFERENCES "direct_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "manager_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "manager_accounts" ("id", "key", "display_name", "avatar_initial", "position") VALUES
  ('manager-1', 'manager_one', '管理者一', '一', 1),
  ('manager-2', 'manager_two', '管理者二', '二', 2)
ON CONFLICT ("id") DO UPDATE SET
  "display_name" = EXCLUDED."display_name",
  "avatar_initial" = EXCLUDED."avatar_initial",
  "position" = EXCLUDED."position",
  "active" = true,
  "updated_at" = CURRENT_TIMESTAMP;
