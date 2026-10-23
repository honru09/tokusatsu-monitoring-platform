import { randomBytes, scryptSync } from "node:crypto";
import { mkdir, writeFile, access } from "node:fs/promises";
import { resolve } from "node:path";
const directory = resolve(process.argv[2] ?? "../../.private-operations");
await mkdir(directory, { recursive: true, mode: 0o700 });
try {
  await access(resolve(directory, "accounts.json"));
  console.log("Operations accounts already initialized; unchanged.");
  process.exit(0);
} catch {}
const accounts = [
  { id: "long", name: "龙" },
  { id: "run", name: "润" },
].map((account) => {
  const password = randomBytes(20).toString("base64url");
  const salt = randomBytes(16).toString("hex");
  return {
    ...account,
    password,
    salt,
    hash: scryptSync(password, salt, 64).toString("hex"),
  };
});
await writeFile(
  resolve(directory, "accounts.json"),
  JSON.stringify(accounts.map(({ password, ...account }) => account)),
  { mode: 0o600, flag: "wx" },
);
await writeFile(
  resolve(directory, "Operations-Accounts.txt"),
  [
    "假面采购 · 运营台访问账号（不是小红书/抖音的登录密码）",
    "请私下分发给对应运营人员，不发到公开聊天，不提交Git。",
    ...accounts.map(
      (a) => `\n${a.name}\n用户名：${a.id}\n运营密码：${a.password}`,
    ),
  ].join("\n"),
  { mode: 0o600, flag: "wx" },
);
console.log(
  "Operations accounts initialized in the private directory. No passwords printed.",
);
