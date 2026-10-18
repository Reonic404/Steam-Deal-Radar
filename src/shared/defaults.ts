import type { ScanStatus, Settings } from "./types";

export const DEFAULT_SETTINGS: Settings = {
  freeGameMonitoring: true,
  majorSalesMonitoring: true,
  smallerPromotions: false,
  desktopNotifications: true,
  notificationSound: true,
  startWithWindows: false,
  scanIntervalMinutes: 30,
  theme: "midnight",
  reducedMotion: false,
  countryCode: "US",
  filterStores: [],
  filterTypes: [],
  hideClaimed: true,
  hideDlcs: false,
};

export const EMPTY_STATUS: ScanStatus = {
  scanning: false,
  lastSuccessAt: null,
  lastError: null,
  sourceLabel: "Not scanned yet",
  offerCount: 0,
  limitations:
    "Listings come from the public Steam search page (unofficial). Prices are regional. Expiration is shown only when Steam provides it.",
};

export const SCAN_INTERVALS = [15, 30, 60, 180] as const;

export const COUNTRY_CODES = [
  "US",
  "GB",
  "DE",
  "FR",
  "NL",
  "SE",
  "NO",
  "CA",
  "AU",
  "JP",
  "BR",
] as const;

export const THEMES = [
  { id: "midnight", label: "Midnight" },
  { id: "ember", label: "Ember" },
  { id: "forest", label: "Forest" },
  { id: "violet", label: "Violet" },
] as const;
