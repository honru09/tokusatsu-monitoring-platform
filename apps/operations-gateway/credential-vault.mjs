import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFile, writeFile, rename } from "node:fs/promises";
import { resolve } from "node:path";

const validPlatform = (id) => ["xiaohongshu", "douyin"].includes(id);
export async function createCredentialVault(directory) {
  const keyPath = resolve(directory, "credential-vault.key");
  let key;
  try { key = await readFile(keyPath); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    // Missing key must never silently replace the key for an existing vault.
    for (const id of ["xiaohongshu", "douyin"]) {
      try { await readFile(resolve(directory, `credentials-${id}.json`)); throw new Error("Vault key missing; restore backup"); }
      catch (e) { if (e.code !== "ENOENT") throw e; }
    }
    key = randomBytes(32);
    try { await writeFile(keyPath, key, { flag: "wx", mode: 0o600 }); }
    catch (e) { if (e.code !== "EEXIST") throw e; key = await readFile(keyPath); }
  }
  if (key.length !== 32) throw new Error("Invalid vault key");
  let tail = Promise.resolve();
  const pathFor = (id) => { if (!validPlatform(id)) throw new Error("Unknown platform"); return resolve(directory, `credentials-${id}.json`); };
  async function read(id) {
    let envelope;
    try { envelope = JSON.parse(await readFile(pathFor(id), "utf8")); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
    if (envelope.v !== 1) throw new Error("Invalid vault version");
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
    decipher.setAAD(Buffer.from(`kamen-operations:${id}:v1`));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]).toString());
  }
  const vault = {
    async status(id) { const value = await read(id); return { saved: Boolean(value?.account || value?.password), hasAccount: Boolean(value?.account), hasPassword: Boolean(value?.password), updatedAt: value?.updatedAt ?? null }; },
    async save(id, input) {
      pathFor(id);
      if (typeof input.account !== "string" || typeof input.password !== "string" || input.account.length > 256 || input.password.length > 256) throw new Error("Invalid credentials");
      const operation = tail.catch(() => {}).then(async () => {
        const value = { account: input.account, password: input.password, updatedAt: new Date().toISOString() };
        const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
        cipher.setAAD(Buffer.from(`kamen-operations:${id}:v1`));
        const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
        const path = pathFor(id);
        await writeFile(path + ".tmp", JSON.stringify({ v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") }), { mode: 0o600 });
        await rename(path + ".tmp", path);
      });
      tail = operation;
      await operation;
      return vault.status(id);
    },
    async clear(id) { return vault.save(id, { account: "", password: "" }); },
    // Server-only; never return this through an HTTP response or logs.
    read,
  };
  return vault;
}
