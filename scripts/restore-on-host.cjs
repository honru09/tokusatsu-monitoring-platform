const { spawnSync } = require("node:child_process");
const path = require("node:path");
const {
  assertPrivateDatabaseUrl,
  databaseUrlForHostPort,
  redactSecrets,
} = require("./database-url.cjs");

function restoreOnHost(env = process.env) {
  const databaseUrl = databaseUrlForHostPort(assertPrivateDatabaseUrl(env));
  const child = spawnSync(
    process.execPath,
    [path.join(__dirname, "restore-seeds.cjs")],
    {
      env: { ...env, DATABASE_URL: databaseUrl },
      encoding: "utf8",
    },
  );
  return {
    status: child.status === 0 ? 0 : 1,
    stdout: redactSecrets(child.stdout ?? ""),
    stderr: redactSecrets(child.stderr ?? child.error?.message ?? ""),
  };
}

if (require.main === module) {
  try {
    const result = restoreOnHost();
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exit(result.status);
  } catch (error) {
    console.error(redactSecrets(error instanceof Error ? error.message : "restore failed"));
    process.exit(1);
  }
}

module.exports = { restoreOnHost };
