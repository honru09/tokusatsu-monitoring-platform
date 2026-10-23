import { randomBytes } from "node:crypto";
import { access, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createCredentialVault } from "./credential-vault.mjs";
const directory = resolve(process.argv[2] ?? "../../.private-operations");
const path = resolve(directory, "browser-control.token");
try { await access(path); }
catch (error) { if (error.code !== "ENOENT") throw error; await writeFile(path, randomBytes(32).toString("base64url"), { mode: 0o600, flag: "wx" }); }
await createCredentialVault(directory);
console.log("Browser control and encrypted vault initialized; no secrets printed.");
