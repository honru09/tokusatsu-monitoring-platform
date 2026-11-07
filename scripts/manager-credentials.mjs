import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

// Keep this array aligned with apps/api/src/auth/auth.service.ts.
export const PUBLISHED_BOOTSTRAP_PASSWORDS = ["666666", "888888"];

export function isPublishedBootstrapPassword(password) {
  return PUBLISHED_BOOTSTRAP_PASSWORDS.includes(password);
}

const { assertPrivateDatabaseUrl } = require("./database-url.cjs");

export { assertPrivateDatabaseUrl };

export function assertReplacementPassword(loginCode, password) {
  if (typeof loginCode !== "string" || loginCode.trim() === "") {
    throw new Error("MANAGER_LOGIN_CODE is required");
  }
  if (typeof password !== "string" || password === "") {
    throw new Error("MANAGER_NEW_PASSWORD is required");
  }
  if (isPublishedBootstrapPassword(password) || password === loginCode) {
    throw new Error(
      "Refusing a published bootstrap password or a password equal to the login code",
    );
  }
  if (password.length < 10) {
    throw new Error("MANAGER_NEW_PASSWORD must be at least 10 characters");
  }
}

export function hashManagerPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyManagerPassword(password, stored) {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  let salt;
  let expected;
  try {
    salt = Buffer.from(parts[1], "base64");
    expected = Buffer.from(parts[2], "base64");
  } catch {
    return false;
  }
  if (!salt.length || expected.length !== 64) return false;
  const computed = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(computed, expected);
}

export async function rotateManagerPassword({ prisma, loginCode, newPassword }) {
  assertReplacementPassword(loginCode, newPassword);
  const account = await prisma.managerAccount.findFirst({
    where: { loginCode },
    select: { id: true },
  });
  if (!account) throw new Error("manager account not found");
  const passwordHash = hashManagerPassword(newPassword);
  try {
    await prisma.managerAccount.update({
      where: { id: account.id },
      data: { passwordHash },
    });
  } catch {
    throw new Error("manager password update failed");
  }
  return { id: account.id };
}

export async function revokePublishedBootstrap(prisma) {
  const accounts = await prisma.managerAccount.findMany({
    select: { id: true, passwordHash: true },
  });
  let examined = 0;
  let revoked = 0;
  for (const account of accounts) {
    if (!account.passwordHash) continue;
    examined += 1;
    const stillPublished = PUBLISHED_BOOTSTRAP_PASSWORDS.some((password) =>
      verifyManagerPassword(password, account.passwordHash),
    );
    if (!stillPublished) continue;
    try {
      await prisma.managerAccount.update({
        where: { id: account.id },
        data: { passwordHash: null },
      });
    } catch {
      throw new Error("manager password revoke failed");
    }
    revoked += 1;
  }
  return { examined, revoked };
}

function loadPrisma(databaseUrl) {
  const here = dirname(fileURLToPath(import.meta.url));
  let PrismaClient;
  try {
    PrismaClient = require("@prisma/client").PrismaClient;
  } catch {
    try {
      PrismaClient = require(resolve(here, "../packages/db/node_modules/@prisma/client")).PrismaClient;
    } catch {
      PrismaClient = require(resolve(here, "../node_modules/@prisma/client")).PrismaClient;
    }
  }
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const command = argv[0];
  if (command !== "rotate" && command !== "revoke-published") {
    console.error(
      "Usage: node scripts/manager-credentials.mjs <rotate|revoke-published>",
    );
    console.error(
      "rotate reads MANAGER_LOGIN_CODE and MANAGER_NEW_PASSWORD from the environment.",
    );
    console.error("Both commands require DATABASE_URL. Values are never printed.");
    return 1;
  }
  const databaseUrl = assertPrivateDatabaseUrl(env);
  const prisma = loadPrisma(databaseUrl);
  try {
    if (command === "rotate") {
      const result = await rotateManagerPassword({
        prisma,
        loginCode: env.MANAGER_LOGIN_CODE,
        newPassword: env.MANAGER_NEW_PASSWORD,
      });
      console.log(`rotated manager account ${result.id}`);
      return 0;
    }
    const result = await revokePublishedBootstrap(prisma);
    console.log(
      `revoked ${result.revoked} published bootstrap verifier(s); examined ${result.examined}`,
    );
    return 0;
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : "manager credential command failed");
      process.exitCode = 1;
    });
}
