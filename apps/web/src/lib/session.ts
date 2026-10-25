/**
 * Manager session token storage. The token lives in a cookie so the
 * /backend proxy can forward it to the API as an Authorization header,
 * and is mirrored in localStorage so the client can tell a session
 * exists (and clear both on logout). The API derives the account from
 * the token; the client never picks an identity anymore.
 */

export const SESSION_COOKIE_NAME = "kamenradar-session";
const SESSION_STORAGE_KEY = "kamenradar.session-token";
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export function storeSessionToken(token: string): void {
  try {
    window.localStorage.setItem(SESSION_STORAGE_KEY, token);
  } catch {
    /* storage may be unavailable; the cookie below is the transport */
  }
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
}

export function clearSessionToken(): void {
  try {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  document.cookie = `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax`;
}

/** Token from a Cookie header (server side of the /backend proxy). */
export function sessionTokenFromCookieHeader(
  cookieHeader: string | null,
): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.split("=");
    if (name?.trim() === SESSION_COOKIE_NAME) {
      const value = rest.join("=").trim();
      if (!value) return null;
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
  }
  return null;
}
