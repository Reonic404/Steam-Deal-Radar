import type { FreeOffer } from "../shared/types";
import { fetchJson, fetchText, mapPool, sleep } from "./http";

const SEARCH_COUNT = 50;
const MAX_PAGES = 8;
const SEARCH_BASE = "https://store.steampowered.com/search/results/";
const SEARCH_HTML = "https://store.steampowered.com/search/";

interface SteamSearchJson {
  desc?: string;
  items?: Array<{ name?: string; logo?: string }>;
  total_count?: number;
}

interface SearchHit {
  appId: number;
  title: string;
  logo: string;
  originalPriceLabel?: string;
  currentPriceLabel?: string;
  discountPercent?: number;
}

interface AppDetailsPrice {
  currency?: string;
  initial?: number;
  final?: number;
  discount_percent?: number;
  initial_formatted?: string;
  final_formatted?: string;
}

interface AppDetailsData {
  type?: string;
  name?: string;
  is_free?: boolean;
  header_image?: string;
  capsule_image?: string;
  steam_appid?: number;
  price_overview?: AppDetailsPrice;
  release_date?: { coming_soon?: boolean; date?: string };
}

type AppDetailsResponse = Record<string, { success: boolean; data?: AppDetailsData }>;

export interface SteamScanResult {
  offers: FreeOffer[];
  sourceLabel: string;
  usedHtmlFallback: boolean;
}

function searchParams(cc: string, start: number): URLSearchParams {
  return new URLSearchParams({
    json: "1",
    specials: "1",
    maxprice: "free",
    hidef2p: "1",
    cc: cc.toLowerCase(),
    l: "english",
    start: String(start),
    count: String(SEARCH_COUNT),
    ndl: "1",
  });
}

export async function discoverSteamFreeOffers(countryCode: string): Promise<SteamScanResult> {
  let usedHtmlFallback = false;
  let hits: SearchHit[] = [];

  try {
    hits = await collectJsonHits(countryCode);
  } catch {
    hits = [];
  }

  if (hits.length === 0) {
    hits = await collectHtmlHits(countryCode);
    usedHtmlFallback = true;
  }

  const unique = dedupeHits(hits);
  const details = await mapPool(unique, 4, async (hit) => {
    await sleep(80);
    return enrichHit(hit, countryCode);
  });

  const offers = details.filter((item): item is FreeOffer => item !== null);
  return {
    offers,
    usedHtmlFallback,
    sourceLabel: usedHtmlFallback
      ? "Steam search page (HTML)"
      : "Steam search page (json=1) + appdetails",
  };
}

async function collectJsonHits(cc: string): Promise<SearchHit[]> {
  const hits: SearchHit[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = `${SEARCH_BASE}?${searchParams(cc, page * SEARCH_COUNT).toString()}`;
    const { data: payload } = await fetchJson<SteamSearchJson>(url);
    const items = payload.items ?? [];
    if (items.length === 0) {
      break;
    }
    for (const item of items) {
      const logo = item.logo ?? "";
      const appId = appIdFromLogo(logo);
      if (!appId || !item.name) {
        continue;
      }
      hits.push({ appId, title: item.name, logo });
    }
    if (items.length < SEARCH_COUNT) {
      break;
    }
  }
  return hits;
}

async function collectHtmlHits(cc: string): Promise<SearchHit[]> {
  const hits: SearchHit[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const params = searchParams(cc, page * SEARCH_COUNT);
    params.delete("json");
    const url = `${SEARCH_HTML}?${params.toString()}`;
    const { text } = await fetchText(url);
    const pageHits = parseSearchHtml(text);
    hits.push(...pageHits);
    if (pageHits.length < SEARCH_COUNT / 2) {
      break;
    }
  }
  return hits;
}

function parseSearchHtml(html: string): SearchHit[] {
  const hits: SearchHit[] = [];
  const rowRe = /<a[^>]*class="[^"]*search_result_row[^"]*"[^>]*>[\s\S]*?<\/a>/gi;
  const rows = html.match(rowRe) ?? [];
  for (const row of rows) {
    const appIdMatch = row.match(/data-ds-appid="(\d+)"/i) ?? row.match(/\/app\/(\d+)/i);
    const titleMatch = row.match(/<span class="title">\s*([^<]+)\s*<\/span>/i);
    const logoMatch = row.match(/<img[^>]+src="([^"]+)"/i);
    const discountMatch = row.match(/discount_pct[^>]*>\s*(-?\d+)\s*%/i);
    const originalMatch = row.match(/discount_original_price[^>]*>\s*([^<]+)/i);
    const finalMatch = row.match(/discount_final_price[^>]*>\s*([^<]+)/i);
    if (!appIdMatch || !titleMatch) {
      continue;
    }
    hits.push({
      appId: Number(appIdMatch[1]),
      title: decodeHtml(titleMatch[1].trim()),
      logo: logoMatch ? decodeHtml(logoMatch[1]) : "",
      discountPercent: discountMatch ? Math.abs(Number(discountMatch[1])) : undefined,
      originalPriceLabel: originalMatch ? cleanPrice(originalMatch[1]) : undefined,
      currentPriceLabel: finalMatch ? cleanPrice(finalMatch[1]) : undefined,
    });
  }
  return hits;
}

async function enrichHit(hit: SearchHit, cc: string): Promise<FreeOffer | null> {
  try {
    const url = `https://store.steampowered.com/api/appdetails?appids=${hit.appId}&cc=${cc.toLowerCase()}&l=english`;
    const { data: payload } = await fetchJson<AppDetailsResponse>(url);
    const entry = payload[String(hit.appId)];
    if (!entry?.success || !entry.data) {
      return offerFromHit(hit);
    }
    const data = entry.data;
    const type = (data.type ?? "unknown").toLowerCase();
    if (type === "demo" || type === "mod" || type === "playtest") {
      return null;
    }
    const price = data.price_overview;
    const isDlc = type === "dlc";
    const discount = price?.discount_percent ?? hit.discountPercent ?? 0;
    const finalCents = price?.final ?? null;
    const initialCents = price?.initial ?? null;
    const isHundredOff = discount >= 100 || finalCents === 0;
    const permanentlyFree = Boolean(data.is_free) && (!price || discount === 0);
    if (permanentlyFree || !isHundredOff) {
      return null;
    }
    if (initialCents !== null && initialCents <= 0 && discount === 0) {
      return null;
    }

    return {
      appId: hit.appId,
      title: data.name ?? hit.title,
      headerImage: data.header_image || data.capsule_image || hit.logo,
      originalPriceLabel:
        formatCents(initialCents, price?.currency) ||
        price?.initial_formatted ||
        hit.originalPriceLabel ||
        "Unknown",
      currentPriceLabel: "Free",
      originalCents: initialCents,
      currentCents: finalCents ?? 0,
      discountPercent: discount || 100,
      type,
      isDlc,
      expiresAt: null,
      storeUrl: `https://store.steampowered.com/app/${hit.appId}/`,
      source: "steam",
    };
  } catch {
    return offerFromHit(hit);
  }
}

function offerFromHit(hit: SearchHit): FreeOffer | null {
  const looksFree =
    hit.discountPercent === 100 ||
    (hit.currentPriceLabel && /free|0[,.]00/i.test(hit.currentPriceLabel));
  if (!looksFree) {
    return null;
  }
  return {
    appId: hit.appId,
    title: hit.title,
    headerImage: hit.logo,
    originalPriceLabel: hit.originalPriceLabel || "Unknown",
    currentPriceLabel: "Free",
    originalCents: null,
    currentCents: 0,
    discountPercent: hit.discountPercent ?? 100,
    type: "unknown",
    isDlc: /dlc|pack|soundtrack/i.test(hit.title),
    expiresAt: null,
    storeUrl: `https://store.steampowered.com/app/${hit.appId}/`,
    source: "steam",
  };
}

function appIdFromLogo(logo: string): number | null {
  const match = logo.match(/\/apps\/(\d+)\//);
  return match ? Number(match[1]) : null;
}

function dedupeHits(hits: SearchHit[]): SearchHit[] {
  const seen = new Set<number>();
  const unique: SearchHit[] = [];
  for (const hit of hits) {
    if (seen.has(hit.appId)) {
      continue;
    }
    seen.add(hit.appId);
    unique.push(hit);
  }
  return unique;
}

function formatCents(cents: number | null, currency?: string): string {
  if (cents === null || Number.isNaN(cents)) {
    return "";
  }
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)}`;
  }
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function cleanPrice(value: string): string {
  return decodeHtml(value).replace(/\s+/g, " ").trim();
}
