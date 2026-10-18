import { contextBridge, ipcRenderer } from "electron";
import type { FreeOffer, MajorSale, ScanStatus, Settings, WishlistItem } from "../shared/types";

const api = {
  getSettings: (): Promise<Settings> => ipcRenderer.invoke("settings:get"),
  setSettings: (patch: Partial<Settings>): Promise<Settings> =>
    ipcRenderer.invoke("settings:set", patch),
  getDeals: (): Promise<FreeOffer[]> => ipcRenderer.invoke("deals:get"),
  scanNow: (): Promise<void> => ipcRenderer.invoke("deals:scan"),
  getSales: (): Promise<MajorSale[]> => ipcRenderer.invoke("sales:get"),
  getStatus: (): Promise<ScanStatus> => ipcRenderer.invoke("scan:status"),
  openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke("shell:open", url),
  getWishlist: (): Promise<string[]> => ipcRenderer.invoke("wishlist:get"),
  getWishlistMetadata: (): Promise<WishlistItem[]> => ipcRenderer.invoke("wishlist:metadata"),
  addWishlist: (appId: number): Promise<string[]> => ipcRenderer.invoke("wishlist:add", appId),
  removeWishlist: (appId: number): Promise<string[]> => ipcRenderer.invoke("wishlist:remove", appId),
  getClaimed: (): Promise<string[]> => ipcRenderer.invoke("claimed:get"),
  markClaimed: (appId: number): Promise<string[]> => ipcRenderer.invoke("claimed:mark", appId),
  unmarkClaimed: (appId: number): Promise<string[]> => ipcRenderer.invoke("claimed:unmark", appId),
  importWishlist: (profile: string): Promise<string[]> => ipcRenderer.invoke("wishlist:import", profile),
  onStatus: (handler: (status: ScanStatus) => void): (() => void) => {
    const listener = (_event: unknown, status: ScanStatus) => handler(status);
    ipcRenderer.on("scan:status", listener);
    return () => ipcRenderer.removeListener("scan:status", listener);
  },
  onDeals: (handler: (offers: FreeOffer[]) => void): (() => void) => {
    const listener = (_event: unknown, offers: FreeOffer[]) => handler(offers);
    ipcRenderer.on("deals:updated", listener);
    return () => ipcRenderer.removeListener("deals:updated", listener);
  },
  onSales: (handler: (sales: MajorSale[]) => void): (() => void) => {
    const listener = (_event: unknown, sales: MajorSale[]) => handler(sales);
    ipcRenderer.on("sales:updated", listener);
    return () => ipcRenderer.removeListener("sales:updated", listener);
  },
  onWishlist: (handler: (items: WishlistItem[]) => void): (() => void) => {
    const listener = (_event: unknown, items: WishlistItem[]) => handler(items);
    ipcRenderer.on("wishlist:updated", listener);
    return () => ipcRenderer.removeListener("wishlist:updated", listener);
  },
};

contextBridge.exposeInMainWorld("steamDealRadar", api);

export type SteamDealRadarApi = typeof api;
