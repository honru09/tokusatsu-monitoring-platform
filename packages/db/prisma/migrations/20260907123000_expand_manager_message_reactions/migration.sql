ALTER TABLE "message_reactions"
  DROP CONSTRAINT IF EXISTS "message_reactions_allowed";

ALTER TABLE "message_reactions"
  ADD CONSTRAINT "message_reactions_allowed"
  CHECK (
    "reaction" IN (
      'heart',
      'agree',
      'check',
      'knife',
      'like',
      'negotiation_success',
      'negotiation_failed'
    )
  );
