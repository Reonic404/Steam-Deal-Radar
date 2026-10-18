import { fetchJson, mapPool, sleep } from "./http";
import { getCachedMetadata, cacheMetadata, WishlistItemMetadata } from "./wishlistCache";

interface SteamAppDetailsResponse {
  [key: string]: {
    success: boolean;
    data?: {
      name?: string;
      header_image?: string;
      type?: string;
      price_overview?: {
        currency?: string;
        initial?: number;
        final?: number;
        discount_percent?: number;
      };
    };
  };
}

const COUNTRY_CODE_MAP: Record<string, string> = {
  US: "USD",
  GB: "GBP",
  DE: "EUR",
  FR: "EUR",
  JP: "JPY",
  CN: "CNY",
  AU: "AUD",
  CA: "CAD",
  RU: "RUB",
  BR: "BRL",
  IN: "INR",
  MX: "MXN",
  KR: "KRW",
  default: "USD",
};

export async function resolveWishlistMetadata(
  appIds: string[],
  countryCode: string,
): Promise<WishlistItemMetadata[]> {
  const results: WishlistItemMetadata[] = [];
  const debugLog = {
    hits: 0,
    misses: 0,
    errors: 0,
    urls: [] as string[],
  };

  // Strict validation: only accept pure numeric IDs
  const validAppIds = appIds.filter((id) => {
    // Must be purely numeric
    if (!/^\d+$/.test(id)) {
      console.log(`[Wishlist Metadata] Skipping non-numeric ID: ${id}`);
      return false;
    }

    const numId = parseInt(id, 10);

    // Exclude extremely large IDs (often marketing/event IDs)
    if (numId > 2_000_000_000) {
      console.log(`[Wishlist Metadata] Skipping invalid ID ${id} (too large, likely an event)`);
      return false;
    }

    // Exclude suspiciously small sequences
    if (numId < 10 && appIds.length > 100) {
      console.log(`[Wishlist Metadata] Skipping invalid ID ${id} (too small in large list)`);
      return false;
    }

    return true;
  });

  // Filter out items that are already cached (fresh)
  const toBeFetched: string[] = [];
  for (const appId of validAppIds) {
    const cached = getCachedMetadata(appId);
    if (cached) {
      results.push(cached);
      debugLog.hits++;
    } else {
      toBeFetched.push(appId);
      debugLog.misses++;
    }
  }

  // Resolve uncached items with concurrency limit of 5
  if (toBeFetched.length > 0) {
    const resolved = await mapPool(toBeFetched, 5, async (appId) => {
      return resolveAppIdMetadata(appId, countryCode, debugLog);
    });

    for (const metadata of resolved) {
      if (!metadata.resolveError) {
        cacheMetadata(metadata);
      }
      results.push(metadata);
    }
  }

  // Log debug info
  console.log(
    `[Wishlist Metadata] Cache hits: ${debugLog.hits}, misses: ${debugLog.misses}, errors: ${debugLog.errors}`,
  );
  if (debugLog.urls.length > 0 && debugLog.urls.length <= 20) {
    console.log(`[Wishlist Metadata] Sample URLs: ${debugLog.urls.slice(0, 5).join(", ")}`);
  } else if (debugLog.urls.length > 20) {
    console.log(`[Wishlist Metadata] Fetched ${debugLog.urls.length} items`);
  }

  return results;
}

async function resolveAppIdMetadata(
  appId: string,
  countryCode: string,
  debugLog: { urls: string[]; errors: number },
): Promise<WishlistItemMetadata> {
  const storeUrl = `https://store.steampowered.com/app/${appId}`;

  // Try Steam API first
  try {
    const url = `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=${countryCode.toUpperCase()}`;
    debugLog.urls.push(url);

    const { data: response } = await fetchJson<SteamAppDetailsResponse>(url);
    const appData = response[appId];

    if (appData?.success && appData.data) {
      const data = appData.data;

      // Filter out demos, bundles, events/fests, and other non-game types
      const invalidTypes = ["demo", "bundle", "advertising", "episode", "video", "soundtruck", "series"];
      if (data.type && invalidTypes.some((t) => data.type?.toLowerCase().includes(t))) {
        const metadata: WishlistItemMetadata = {
          appId,
          title: data.name || `App ${appId}`,
          headerImage: "",
          originalPriceLabel: "Not a game",
          currentPriceLabel: "Filtered",
          originalCents: null,
          currentCents: null,
          discountPercent: 0,
          storeUrl,
          resolveError: `Item is a ${data.type}, not a playable game`,
        };
        return metadata;
      }

      const priceInfo = data.price_overview || {};

      const metadata: WishlistItemMetadata = {
        appId,
        title: data.name || `App ${appId}`,
        headerImage: data.header_image || "",
        originalPriceLabel: formatPrice(priceInfo.initial, priceInfo.currency || "USD"),
        currentPriceLabel: formatPrice(priceInfo.final, priceInfo.currency || "USD"),
        originalCents: priceInfo.initial || null,
        currentCents: priceInfo.final || null,
        discountPercent: priceInfo.discount_percent || 0,
        storeUrl,
      };

      return metadata;
    }
  } catch (err) {
    debugLog.errors++;
    // Fallback to HTML scraping if API fails
  }

  // Fallback: return minimal metadata with error
  const metadata: WishlistItemMetadata = {
    appId,
    title: `App ${appId}`,
    headerImage: "",
    originalPriceLabel: "Unknown",
    currentPriceLabel: "Unknown",
    originalCents: null,
    currentCents: null,
    discountPercent: 0,
    storeUrl,
    resolveError: "Could not resolve metadata from API",
  };

  return metadata;
}

function formatPrice(cents: number | undefined, currency: string): string {
  if (!cents) {
    return "Free";
  }

  const currencySymbols: Record<string, string> = {
    USD: "$",
    EUR: "€",
    GBP: "£",
    JPY: "¥",
    CNY: "¥",
    AUD: "A$",
    CAD: "C$",
    RUB: "?",
    BRL: "R$",
    INR: "?",
    MXN: "$",
    KRW: "?",
  };

  const symbol = currencySymbols[currency] || currency;
  const dollars = cents / 100;

  if (currency === "JPY" || currency === "KRW") {
    return `${symbol}${Math.round(dollars)}`;
  }

  return `${symbol}${dollars.toFixed(2)}`;
}
