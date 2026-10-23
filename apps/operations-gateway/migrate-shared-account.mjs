import { copyFile, readFile, writeFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { constants } from "node:fs";
const directory = resolve(process.argv[2] ?? "../../.private-operations");
const accountFile = resolve(directory, "accounts.json");
const accounts = JSON.parse(await readFile(accountFile, "utf8"));
if (accounts.length === 1 && accounts[0].id === "shared") {
  console.log("Shared operations account already configured.");
} else {
  const primary = accounts.find((a) => a.id === "long");
  if (!primary) throw new Error("Existing primary account required");
  await copyFile(accountFile, resolve(directory, "accounts.pre-shared.json"), constants.COPYFILE_EXCL);
  const sessionsFile = resolve(directory, "sessions.json");
  let sessions = [];
  try {
    sessions = JSON.parse(await readFile(sessionsFile, "utf8"));
    await copyFile(sessionsFile, resolve(directory, "sessions.pre-shared.json"), constants.COPYFILE_EXCL);
  } catch (e) { if (e.code !== "ENOENT") throw e; }
  await writeFile(accountFile + ".tmp", JSON.stringify([{ ...primary, id: "shared", name: "共同运营" }]), { mode: 0o600 });
  await rename(accountFile + ".tmp", accountFile);
  await writeFile(sessionsFile + ".tmp", JSON.stringify(sessions.filter(([, s]) => ["long", "run"].includes(s.accountId)).map(([key, s]) => [key, { ...s, accountId: "shared", name: "共同运营" }])), { mode: 0o600 });
  await rename(sessionsFile + ".tmp", sessionsFile);
  console.log("Shared account prepared. Existing primary password and active sessions retained. Previous configuration backed up.");
}
