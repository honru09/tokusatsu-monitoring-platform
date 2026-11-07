function assertPrivateDatabaseUrl(env = process.env) {
  const url = typeof env.DATABASE_URL === "string" ? env.DATABASE_URL.trim() : "";
  if (!url) {
    throw new Error(
      "DATABASE_URL is required. Refusing to use a built-in database credential.",
    );
  }
  if (url.includes("change-me-in-production")) {
    throw new Error(
      "DATABASE_URL uses a published placeholder password. Set a private password outside the repository.",
    );
  }
  return url;
}

function databaseUrlForHostPort(databaseUrl, host = "127.0.0.1", port = "55432") {
  const url = new URL(databaseUrl);
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error("DATABASE_URL must be a postgres URL");
  }
  url.hostname = host;
  url.port = String(port);
  return url.toString();
}

function redactSecrets(value) {
  return String(value).replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://<redacted>");
}

module.exports = {
  assertPrivateDatabaseUrl,
  databaseUrlForHostPort,
  redactSecrets,
};
