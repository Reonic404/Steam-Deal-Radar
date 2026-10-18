import type { FreeOffer, MajorSale, ScanStatus, Settings } from "./types";

export interface SteamDealRadarApi {
  getSettings: () => Promise<Settings>;
  setSettings: (patch: Partial<Settings>) => Promise<Settings>;
  getDeals: () => Promise<FreeOffer[]>;
  scanNow: () => Promise<void>;
  getSales: () => Promise<MajorSale[]>;
  getStatus: () => Promise<ScanStatus>;
  openExternal: (url: string) => Promise<boolean>;
  onStatus: (handler: (status: ScanStatus) => void) => () => void;
  onDeals: (handler: (offers: FreeOffer[]) => void) => () => void;
  onSales: (handler: (sales: MajorSale[]) => void) => () => void;
  getWishlist: () => Promise<string[]>;
  addWishlist: (appId: number) => Promise<string[]>;
  removeWishlist: (appId: number) => Promise<string[]>;
  importWishlist: (profile: string) => Promise<string[]>;
  getClaimed: () => Promise<string[]>;
  markClaimed: (appId: number) => Promise<string[]>;
  unmarkClaimed: (appId: number) => Promise<string[]>;
}
