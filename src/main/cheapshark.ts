import type { FreeOffer } from "../shared/types";
import { fetchJson } from "./http";

interface CheapSharkDeal {
  steamAppID?: string;
  title?: string;
  salePrice?: string;
  normalPrice?: string;
  savings?: string;
  thumb?: string;
}

export async function discoverCheapSharkFreeSteam(): Promise<FreeOffer[]> {
  const { data: deals } = await fetchJson<CheapSharkDeal[]>(
    "https://www.cheapshark.com/api/1.0/deals?storeID=1&upperPrice=0&pageSize=60",
  );
  if (!Array.isArray(deals)) {
    return [];
  }
  const offers: FreeOffer[] = [];
  const seen = new Set<number>();
  for (const deal of deals) {
    const appId = Number(deal.steamAppID);
    if (!appId || seen.has(appId) || !deal.title) {
      continue;
    }
    const sale = Number(deal.salePrice);
    if (!Number.isNaN(sale) && sale > 0) {
      continue;
    }
    seen.add(appId);
    offers.push({
      appId,
      title: deal.title,
      headerImage: deal.thumb || "",
      originalPriceLabel: deal.normalPrice ? `$${deal.normalPrice}` : "Unknown",
      currentPriceLabel: "Free",
      originalCents: deal.normalPrice ? Math.round(Number(deal.normalPrice) * 100) : null,
      currentCents: 0,
      discountPercent: Math.round(Number(deal.savings) || 100),
      type: "unknown",
      isDlc: /dlc|pack/i.test(deal.title),
      expiresAt: null,
      storeUrl: `https://store.steampowered.com/app/${appId}/`,
      source: "cheapshark",
    });
  }
  return offers;
}
