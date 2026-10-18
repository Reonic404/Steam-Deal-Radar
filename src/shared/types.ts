export type ThemeId = "midnight" | "ember" | "forest" | "violet";

export interface Settings {
  freeGameMonitoring: boolean;
  majorSalesMonitoring: boolean;
  smallerPromotions: boolean;
  desktopNotifications: boolean;
  notificationSound: boolean;
  startWithWindows: boolean;
  scanIntervalMinutes: number;
  theme: ThemeId;
  reducedMotion: boolean;
  countryCode: string;
  // Advanced filtering and UI options
  filterStores: string[];
  filterTypes: string[];
  hideClaimed: boolean;
  hideDlcs: boolean;
}

export interface FreeOffer {
  appId: number;
  title: string;
  headerImage: string;
  originalPriceLabel: string;
  currentPriceLabel: string;
  originalCents: number | null;
  currentCents: number | null;
  discountPercent: number;
  type: string;
  isDlc: boolean;
  expiresAt: string | null;
  storeUrl: string;
  source: "steam" | "cheapshark";
  // UI-only flags (optional)
  wishlisted?: boolean;
  claimed?: boolean;
}

export interface ScanStatus {
  scanning: boolean;
  lastSuccessAt: string | null;
  lastError: string | null;
  sourceLabel: string;
  offerCount: number;
  limitations: string;
}

export interface MajorSale {
  id: string;
  name: string;
  kind: "seasonal" | "fest";
  startAt: string;
  endAt: string;
  timezoneNote: string;
  sourceUrl: string;
  sourceName: string;
}

export interface WishlistItem {
  appId: string;
  title: string;
  headerImage: string;
  originalPriceLabel: string;
  currentPriceLabel: string;
  originalCents: number | null;
  currentCents: number | null;
  discountPercent: number;
  storeUrl: string;
  isDiscounted?: boolean;
  isFree?: boolean;
  resolveError?: string;
}

export interface AppState {
  settings: Settings;
  offers: FreeOffer[];
  sales: MajorSale[];
  status: ScanStatus;
}
