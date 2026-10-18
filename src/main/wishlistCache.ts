import path from "node:path";
import fs from "node:fs";
import { app } from "electron";

export interface WishlistItemMetadata {
  appId: string;
  title: string;
  headerImage: string;
  originalPriceLabel: string;
  currentPriceLabel: string;
  originalCents: number | null;
  currentCents: number | null;
  discountPercent: number;
  storeUrl: string;
  resolveError?: string;
}

export interface CacheEntry {
  metadata: WishlistItemMetadata;
  fetchedAt: string;
}

type WishlistCacheData = Record<string, CacheEntry>;

function cacheFilePath(): string {
  return path.join(app.getPath("userData"), "wishlist-cache.json");
}

function loadCacheData(): WishlistCacheData {
  try {
    const data = fs.readFileSync(cacheFilePath(), "utf8");
    return JSON.parse(data) as WishlistCacheData;
  } catch {
    return {};
  }
}

function saveCacheData(data: WishlistCacheData): void {
  fs.mkdirSync(path.dirname(cacheFilePath()), { recursive: true });
  fs.writeFileSync(cacheFilePath(), JSON.stringify(data, null, 2), "utf8");
}

export function getCachedMetadata(appId: string): WishlistItemMetadata | null {
  const cache = loadCacheData();
  const entry = cache[appId];
  if (!entry) {
    return null;
  }

  // Check if cache entry is less than 24 hours old
  const fetchedTime = new Date(entry.fetchedAt).getTime();
  const now = Date.now();
  const age = now - fetchedTime;
  const twentyFourHours = 24 * 60 * 60 * 1000;

  if (age < twentyFourHours) {
    return entry.metadata;
  }

  // Cache expired, remove it
  delete cache[appId];
  saveCacheData(cache);
  return null;
}

export function cacheMetadata(metadata: WishlistItemMetadata): void {
  const cache = loadCacheData();
  cache[metadata.appId] = {
    metadata,
    fetchedAt: new Date().toISOString(),
  };
  saveCacheData(cache);
}

export function isCacheFresh(appId: string): boolean {
  return getCachedMetadata(appId) !== null;
}

export function clearExpiredCache(): void {
  const cache = loadCacheData();
  const now = Date.now();
  const twentyFourHours = 24 * 60 * 60 * 1000;
  let changed = false;

  for (const appId in cache) {
    const entry = cache[appId];
    const fetchedTime = new Date(entry.fetchedAt).getTime();
    const age = now - fetchedTime;

    if (age >= twentyFourHours) {
      delete cache[appId];
      changed = true;
    }
  }

  if (changed) {
    saveCacheData(cache);
  }
}
