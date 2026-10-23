// Run against the local PostgreSQL container; all fixtures and DDL are rolled back.
const { readFileSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const { join } = require("node:path");

const migration = readFileSync(
  join(
    __dirname,
    "../packages/db/prisma/migrations/20260905110000_comparison_evidence_invalidation/migration.sql",
  ),
  "utf8",
)
  .replace(/^BEGIN;\s*/u, "")
  .replace(/COMMIT;\s*$/u, "");
const sql = `
BEGIN;
SET LOCAL lock_timeout = '3s';
CREATE SCHEMA verify_comparison_invalidation;
SET LOCAL search_path = verify_comparison_invalidation, pg_catalog;
CREATE TABLE product_market_comparisons (
  id text PRIMARY KEY, status text, product_id text, source_id text,
  reference_price_cny numeric, reference_url text, reference_title text,
  matched_count integer, confidence double precision, observed_at timestamptz,
  last_error text, updated_at timestamptz
);
CREATE TABLE cross_market_opportunities (
  id text PRIMARY KEY, comparison_id text, status text, missing_facts text[],
  rejection_reason text, evaluated_at timestamptz, updated_at timestamptz,
  comparison_observed_at timestamptz, xianyu_reference_price_cny numeric
);
CREATE TABLE exchange_rates (pair text PRIMARY KEY, rate numeric, fetched_at timestamptz);
INSERT INTO product_market_comparisons VALUES
 ('legacy', 'ready', 'p1', 's1', 600, 'test', 'test', 3, 0.95, now(), 'failed refresh', now()),
 ('current', 'ready', 'p2', 's1', 600, 'test', 'test', 3, 0.95, now(), null, now());
INSERT INTO cross_market_opportunities VALUES
 ('old', 'legacy', 'ready', '{}', null, now(), now(), now(), 600),
 ('live', 'current', 'ready', '{}', null, now(), now(), now(), 600);
INSERT INTO exchange_rates VALUES ('JPY_CNY', 0.05, now());
${migration}
DO $$ BEGIN
 IF (SELECT status FROM product_market_comparisons WHERE id='legacy') <> 'failed'
 OR (SELECT status FROM cross_market_opportunities WHERE id='old') <> 'needs_facts'
 THEN RAISE EXCEPTION 'legacy evidence was not withdrawn'; END IF;
 IF (SELECT reference_price_cny FROM product_market_comparisons WHERE id='legacy') <> 600
 THEN RAISE EXCEPTION 'historical price was deleted'; END IF;
 IF (SELECT status FROM cross_market_opportunities WHERE id='live') <> 'ready'
 THEN RAISE EXCEPTION 'unchanged evidence was invalidated'; END IF;
END $$;
UPDATE product_market_comparisons SET updated_at=now() WHERE id='current';
DO $$ BEGIN
 IF (SELECT status FROM cross_market_opportunities WHERE id='live') <> 'ready'
 THEN RAISE EXCEPTION 'audit-only update invalidated evidence'; END IF;
END $$;
UPDATE product_market_comparisons SET reference_price_cny=601 WHERE id='current';
DO $$ BEGIN
 IF (SELECT status FROM cross_market_opportunities WHERE id='live') <> 'needs_facts'
 THEN RAISE EXCEPTION 'price change did not invalidate evidence'; END IF;
END $$;
UPDATE cross_market_opportunities SET status='ready' WHERE id='live';
UPDATE product_market_comparisons SET status='failed' WHERE id='current';
DO $$ BEGIN
 IF (SELECT status FROM cross_market_opportunities WHERE id='live') <> 'needs_facts'
 THEN RAISE EXCEPTION 'failed refresh did not invalidate evidence'; END IF;
END $$;
UPDATE cross_market_opportunities SET status='ready' WHERE id='live';
UPDATE exchange_rates SET rate=0.06 WHERE pair='JPY_CNY';
DO $$ BEGIN
 IF (SELECT status FROM cross_market_opportunities WHERE id='live') <> 'needs_facts'
 THEN RAISE EXCEPTION 'exchange change did not invalidate evidence'; END IF;
END $$;
UPDATE cross_market_opportunities SET status='ready' WHERE id='live';
DELETE FROM exchange_rates WHERE pair='JPY_CNY';
DO $$ BEGIN
 IF (SELECT status FROM cross_market_opportunities WHERE id='live') <> 'needs_facts'
 THEN RAISE EXCEPTION 'exchange removal did not invalidate evidence'; END IF;
END $$;
ROLLBACK;
SELECT 'comparison invalidation: PASS (all fixtures rolled back)' AS result;
`;
const result = spawnSync(
  "docker",
  [
    "compose",
    "--env-file",
    ".env",
    "-f",
    "infrastructure/docker-compose.yml",
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    "tokusatsu",
    "-d",
    "tokusatsu",
    "-v",
    "ON_ERROR_STOP=1",
  ],
  {
    cwd: join(__dirname, ".."),
    input: sql,
    encoding: "utf8",
    timeout: 30000,
  },
);
process.stdout.write(result.stdout || "");
process.stderr.write(result.stderr || "");
if (result.error) process.stderr.write(result.error.message + "\n");
process.exitCode = result.status ?? 1;
