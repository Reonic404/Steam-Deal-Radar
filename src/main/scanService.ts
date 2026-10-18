import { EMPTY_STATUS } from "../shared/defaults";
import type { FreeOffer, ScanStatus, Settings } from "../shared/types";
import { discoverCheapSharkFreeSteam } from "./cheapshark";
import { HttpError } from "./http";
import { listSales } from "./salesCatalog";
import { discoverSteamFreeOffers } from "./steamDeals";

export interface ScanOutcome {
  offers: FreeOffer[];
  status: ScanStatus;
}

export async function runScan(settings: Settings, previous: ScanStatus): Promise<ScanOutcome> {
  if (!settings.freeGameMonitoring) {
    return {
      offers: [],
      status: {
        ...previous,
        scanning: false,
        offerCount: 0,
        sourceLabel: "Free-game monitoring is off",
        lastError: null,
      },
    };
  }

  try {
    const steam = await discoverSteamFreeOffers(settings.countryCode);
    if (steam.offers.length > 0) {
      return {
        offers: steam.offers,
        status: {
          scanning: false,
          lastSuccessAt: new Date().toISOString(),
          lastError: null,
          sourceLabel: steam.sourceLabel,
          offerCount: steam.offers.length,
          limitations: EMPTY_STATUS.limitations,
        },
      };
    }

    try {
      const fallback = await discoverCheapSharkFreeSteam();
      return {
        offers: fallback,
        status: {
          scanning: false,
          lastSuccessAt: new Date().toISOString(),
          lastError: null,
          sourceLabel: steam.usedHtmlFallback
            ? "Steam HTML empty; CheapShark last resort"
            : "Steam returned no 100% offers; CheapShark last resort",
          offerCount: fallback.length,
          limitations:
            "CheapShark is USD-only, updates about hourly, and can miss Steam-only promotions. Region: " +
            settings.countryCode,
        },
      };
    } catch (cheapError) {
      return {
        offers: [],
        status: {
          scanning: false,
          lastSuccessAt: previous.lastSuccessAt,
          lastError: errorMessage(cheapError),
          sourceLabel: steam.sourceLabel,
          offerCount: 0,
          limitations: EMPTY_STATUS.limitations,
        },
      };
    }
  } catch (error) {
    try {
      const fallback = await discoverCheapSharkFreeSteam();
      return {
        offers: fallback,
        status: {
          scanning: false,
          lastSuccessAt: new Date().toISOString(),
          lastError: `Steam search failed; used CheapShark. ${errorMessage(error)}`,
          sourceLabel: "CheapShark last resort",
          offerCount: fallback.length,
          limitations:
            "Steam search was unavailable. CheapShark is USD-only and incomplete. Region: " +
            settings.countryCode,
        },
      };
    } catch (cheapError) {
      return {
        offers: [],
        status: {
          scanning: false,
          lastSuccessAt: previous.lastSuccessAt,
          lastError: `${errorMessage(error)} | CheapShark: ${errorMessage(cheapError)}`,
          sourceLabel: "Scan failed",
          offerCount: 0,
          limitations: EMPTY_STATUS.limitations,
        },
      };
    }
  }
}

export function visibleSales(settings: Settings) {
  return listSales(settings.smallerPromotions);
}

function errorMessage(error: unknown): string {
  if (error instanceof HttpError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error";
}
