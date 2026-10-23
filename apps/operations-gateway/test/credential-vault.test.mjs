import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCredentialVault } from "../credential-vault.mjs";

test("vault survives restart, uses fresh IVs, rejects tampering and cross-platform ciphertext", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kamen-vault-"));
  try {
    const vault = await createCredentialVault(dir);
    const input = { account: "fixture-user", password: "fixture-password" };
    await vault.save("douyin", input);
    const first = await readFile(join(dir, "credentials-douyin.json"), "utf8");
    await vault.save("douyin", input);
    assert.notEqual(await readFile(join(dir, "credentials-douyin.json"), "utf8"), first);
    const restarted = await createCredentialVault(dir);
    assert.equal((await restarted.read("douyin")).password, input.password);
    await writeFile(join(dir, "credentials-xiaohongshu.json"), first);
    await assert.rejects(restarted.read("xiaohongshu"));
    await assert.rejects(restarted.save("../escape", input));
    const tampered = JSON.parse(first); tampered.tag = Buffer.alloc(16).toString("base64");
    await writeFile(join(dir, "credentials-douyin.json"), JSON.stringify(tampered));
    await assert.rejects(restarted.read("douyin"));
    await rm(join(dir, "credential-vault.key"));
    await assert.rejects(createCredentialVault(dir), /Vault key missing/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
