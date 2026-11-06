import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  assertReplacementPassword,
  hashManagerPassword,
  isPublishedBootstrapPassword,
  revokePublishedBootstrap,
  rotateManagerPassword,
  verifyManagerPassword,
} from "./manager-credentials.mjs";

const scriptPath = fileURLToPath(new URL("./manager-credentials.mjs", import.meta.url));
const authSource = readFileSync(
  fileURLToPath(new URL("../apps/api/src/auth/auth.service.ts", import.meta.url)),
  "utf8",
);
const scriptSource = readFileSync(scriptPath, "utf8");

function passwordList(source) {
  const match = source.match(/PUBLISHED_BOOTSTRAP_PASSWORDS = (\[[^\]]+\])/);
  assert.ok(match, "published bootstrap password list is missing");
  return match[1];
}

test("api and credential script share the published bootstrap password list", () => {
  assert.equal(passwordList(authSource), passwordList(scriptSource));
  assert.equal(isPublishedBootstrapPassword("correct horse"), false);
});

test("rotation refuses published or short passwords and stores a matching verifier", async () => {
  assert.throws(
    () => assertReplacementPassword("account", "888888"),
    /published bootstrap password/,
  );
  assert.throws(
    () => assertReplacementPassword("account", "account"),
    /login code/,
  );
  const password = "rotated-secret";
  const updates = [];
  const prisma = {
    managerAccount: {
      findFirst: async () => ({ id: "manager-1" }),
      update: async ({ data }) => {
        updates.push(data.passwordHash);
      },
    },
  };
  const result = await rotateManagerPassword({
    prisma,
    loginCode: "666666",
    newPassword: password,
  });
  assert.equal(result.id, "manager-1");
  assert.equal(updates.length, 1);
  assert.equal(verifyManagerPassword(password, updates[0]), true);
  assert.equal(verifyManagerPassword("666666", updates[0]), false);
  assert.doesNotMatch(JSON.stringify(result), /scrypt\$/);
});

test("revoke clears only verifiers that still match a published bootstrap password", async () => {
  const published = hashManagerPassword("666666");
  const rotated = hashManagerPassword("rotated-secret");
  const writes = [];
  const prisma = {
    managerAccount: {
      findMany: async () => [
        { id: "published", passwordHash: published },
        { id: "rotated", passwordHash: rotated },
        { id: "empty", passwordHash: null },
      ],
      update: async ({ where, data }) => {
        writes.push({ id: where.id, passwordHash: data.passwordHash });
      },
    },
  };
  const result = await revokePublishedBootstrap(prisma);
  assert.deepEqual(result, { examined: 2, revoked: 1 });
  assert.deepEqual(writes, [{ id: "published", passwordHash: null }]);
});

test("the command exits before connecting when DATABASE_URL is missing and prints no verifier", () => {
  const result = spawnSync(process.execPath, [scriptPath, "revoke-published"], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "" },
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /DATABASE_URL is required/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /scrypt\$/);
});
