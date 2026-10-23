export type CredentialedDiscoverySource =
  | "yahoo_shopping"
  | "firecrawl_market"
  | "apify_ecommerce";

const requirements: Record<
  CredentialedDiscoverySource,
  { flag: string; credential: string }
> = {
  yahoo_shopping: {
    flag: "YAHOO_SHOPPING_SEARCH_ENABLED",
    credential: "YAHOO_SHOPPING_CLIENT_ID",
  },
  firecrawl_market: {
    flag: "FIRECRAWL_DISCOVERY_ENABLED",
    credential: "FIRECRAWL_API_KEY",
  },
  apify_ecommerce: {
    flag: "APIFY_ECOMMERCE_ENABLED",
    credential: "APIFY_TOKEN",
  },
};

/** Credentialed sources are opt-in and fail closed on absent/blank secrets. */
export function credentialedSourceEnabled(
  source: CredentialedDiscoverySource,
  env: Record<string, string | undefined> = process.env,
) {
  const requirement = requirements[source];
  return (
    env[requirement.flag]?.trim().toLowerCase() === "true" &&
    Boolean(env[requirement.credential]?.trim())
  );
}
