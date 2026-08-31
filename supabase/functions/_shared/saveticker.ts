const SAVETICKER_HOST = "saveticker.com";
const REQUEST_TIMEOUT_MS = 20_000;

interface StorageStateCookie {
  name?: unknown;
  value?: unknown;
  domain?: unknown;
}

interface StorageState {
  cookies?: unknown;
}

function decodeBase64Utf8(value: string): string {
  const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function cookieHeaderFromSecret(): string {
  const encodedState = Deno.env.get("SAVETICKER_AUTH_JSON_B64")?.trim();
  if (!encodedState) {
    throw new Error("SaveTicker Edge authentication is not configured.");
  }

  let state: StorageState;
  try {
    state = JSON.parse(decodeBase64Utf8(encodedState)) as StorageState;
  } catch {
    throw new Error("SaveTicker Edge authentication is invalid.");
  }

  const cookies = Array.isArray(state.cookies)
    ? state.cookies as StorageStateCookie[]
    : [];
  const pairs: string[] = [];

  for (const cookie of cookies) {
    if (!cookie || typeof cookie !== "object") continue;

    const name = typeof cookie.name === "string" ? cookie.name : "";
    const value = typeof cookie.value === "string" ? cookie.value : "";
    const domain = typeof cookie.domain === "string"
      ? cookie.domain.replace(/^\./, "").toLowerCase()
      : "";

    if (name && value && domain && SAVETICKER_HOST.endsWith(domain)) {
      pairs.push(`${name}=${value}`);
    }
  }

  if (pairs.length === 0) {
    throw new Error("SaveTicker Edge authentication contains no usable cookies.");
  }

  return pairs.join("; ");
}

export async function fetchSaveTickerJson(
  url: string,
  referer: string,
): Promise<unknown> {
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      Accept: "application/json",
      Cookie: cookieHeaderFromSecret(),
      Referer: referer,
      "User-Agent": "SpyConverterSaveTickerEdge/1.0 (+https://spyconverter.com)",
    },
  });

  if (!response.ok) {
    throw new Error(`SaveTicker returned HTTP ${response.status}.`);
  }

  return await response.json();
}
