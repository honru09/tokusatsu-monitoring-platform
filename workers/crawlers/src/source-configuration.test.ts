import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryFile = (path: string) =>
  readFileSync(
    fileURLToPath(new URL(`../../../${path}`, import.meta.url)),
    "utf8",
  );

function serviceBlock(compose: string, service: string, nextService: string) {
  const match = compose.match(
    new RegExp(
      `^  ${service}:\\r?\\n(?<block>.*?)^  ${nextService}:\\r?\\n`,
      "ms",
    ),
  );
  if (!match?.groups?.block)
    throw new Error(`Missing ${service} service block`);
  return match.groups.block;
}

describe("crawler source secret configuration", () => {
  it("passes optional crawler credentials from the Compose process into their consumers", () => {
    const compose = repositoryFile("infrastructure/docker-compose.yml");
    const api = serviceBlock(compose, "api", "worker");
    const worker = serviceBlock(compose, "worker", "web");

    expect(api).toContain("FIRECRAWL_API_KEY: ${FIRECRAWL_API_KEY:-}");
    expect(worker).toContain("FIRECRAWL_API_KEY: ${FIRECRAWL_API_KEY:-}");
    expect(worker).toContain("APIFY_TOKEN: ${APIFY_TOKEN:-}");
    expect(worker).toContain(
      "YAHOO_SHOPPING_CLIENT_ID: ${YAHOO_SHOPPING_CLIENT_ID:-}",
    );
  });

  it("keeps credentialed discovery sources fail-closed in the example environment", () => {
    const example = repositoryFile(".env.example");

    expect(example).toMatch(/^FIRECRAWL_DISCOVERY_ENABLED=false$/m);
    expect(example).toMatch(/^FIRECRAWL_API_KEY=$/m);
    expect(example).toMatch(/^APIFY_ECOMMERCE_ENABLED=false$/m);
    expect(example).toMatch(/^APIFY_TOKEN=$/m);
    expect(example).toMatch(/^YAHOO_SHOPPING_CLIENT_ID=$/m);
    expect(example).toMatch(/^MANDARAKE_SEARCH_ENABLED=false$/m);
  });

  it("uses provider-specific secret parsing and disables stale switches when credentials are absent", () => {
    const deploy = repositoryFile("scripts/deploy.ps1");

    expect(deploy).not.toContain("function Get-LocalSecret");
    expect(deploy).toContain("function Read-CrawlerSecret");
    expect(deploy).toContain("'^fc-[A-Za-z0-9_-]{16,}$'");
    expect(deploy).toContain("'^apify_api_[A-Za-z0-9_-]{16,}$'");
    expect(deploy).toMatch(/FIRECRAWL_DISCOVERY_ENABLED\s*=\s*'false'/);
    expect(deploy).toMatch(/APIFY_ECOMMERCE_ENABLED\s*=\s*'false'/);
    expect(deploy).toMatch(/YAHOO_SHOPPING_SEARCH_ENABLED\s*=\s*'false'/);
  });
});
