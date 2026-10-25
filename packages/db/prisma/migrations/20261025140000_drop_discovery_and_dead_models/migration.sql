-- Drop the discovery feedback table and the never-wired schema.
--
-- discovery_feedback was written only by the removed DiscoveryService
-- (see the preceding commit); Character / ProductCharacter /
-- PhysicalStore / Alert had no Prisma accessor call anywhere in the
-- API, the crawler worker or the services. Dropping a table removes its
-- own foreign keys with it, so no separate constraint cleanup is
-- needed; product_characters goes first because it references
-- characters.

DROP TABLE IF EXISTS "discovery_feedback";
DROP TABLE IF EXISTS "product_characters";
DROP TABLE IF EXISTS "characters";
DROP TABLE IF EXISTS "PhysicalStore";
DROP TABLE IF EXISTS "Alert";

DROP TYPE IF EXISTS "DiscoveryAction";
