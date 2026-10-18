import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  shell,
  Tray,
} from "electron";
import path from "node:path";
import { existsSync } from "node:fs";
import { DEFAULT_SETTINGS, EMPTY_STATUS } from "../shared/defaults";
import type { FreeOffer, ScanStatus, Settings, WishlistItem } from "../shared/types";
import { notifyNewFinds } from "./notifications";
import { runScan, visibleSales } from "./scanService";
import { loadSettings, saveSettings, sanitizeSettings } from "./settingsStore";
import { loadWishlist, saveWishlist } from "./wishlistStore";
import { loadClaimed, saveClaimed } from "./claimedStore";
import { fetchJson, fetchText } from "./http";
import { resolveWishlistMetadata } from "./wishlistResolver";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let settings: Settings = { ...DEFAULT_SETTINGS };
let offers: FreeOffer[] = [];
let status: ScanStatus = { ...EMPTY_STATUS };
let scanTimer: NodeJS.Timeout | null = null;
let scanning = false;
let quitting = false;
let wishlistIds: Set<string> = new Set();
let claimedIds: Set<string> = new Set();
let resolvedWishlistItems: Map<string, WishlistItem> = new Map();

function iconFile(name: string): string {
  return path.join(app.getAppPath(), "build", name);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 740,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#0b1220",
    title: "Steam Deal Radar",
    autoHideMenuBar: true,
    icon: nativeImage.createFromPath(iconFile("icon.png")),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const indexHtml = path.join(__dirname, "../renderer/index.html");
  const devServerUrl = process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5173";

  // In packaged apps load the built renderer. Also, when running from source
  // after an explicit build the `dist/renderer/index.html` will exist — prefer
  // that over the dev server so `npm start` (which runs a build then
  // `electron .`) loads the built UI. Otherwise fall back to the Vite dev
  // server URL for development.
  if (app.isPackaged || existsSync(indexHtml)) {
    void mainWindow.loadFile(indexHtml);
  } else {
    void mainWindow.loadURL(devServerUrl);
  }

  mainWindow.on("close", (event) => {
    if (quitting) {
      return;
    }
    event.preventDefault();
    mainWindow?.hide();
  });
}

function showWindow(): void {
  if (!mainWindow) {
    createWindow();
    return;
  }
  mainWindow.show();
  mainWindow.focus();
}

function createTray(): void {
  const image = nativeImage.createFromPath(iconFile("icon.png"));
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image.resize({ width: 16, height: 16 }));
  tray.setToolTip("Steam Deal Radar");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open", click: () => showWindow() },
      { label: "Check Now", click: () => void scanNow() },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on("click", () => showWindow());
}

function applyStartupSetting(): void {
  app.setLoginItemSettings({
    openAtLogin: settings.startWithWindows,
    path: process.execPath,
    args: app.isPackaged ? [] : [path.resolve(process.argv[1] ?? ".")],
  });
}

function broadcast(): void {
  const sales = visibleSales(settings);
  const annotated = offers.map((offer) => ({
    ...offer,
    wishlisted: wishlistIds.has(String(offer.appId)),
    claimed: claimedIds.has(String(offer.appId)),
  }));
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("scan:status", status);
    window.webContents.send("deals:updated", annotated);
    window.webContents.send("sales:updated", sales);
    window.webContents.send("wishlist:updated", Array.from(resolvedWishlistItems.values()));
  }
}

async function scanNow(): Promise<void> {
  if (scanning) {
    return;
  }
  scanning = true;
  status = { ...status, scanning: true, lastError: null };
  broadcast();
  const outcome = await runScan(settings, status);
  offers = outcome.offers;
  status = outcome.status;
  scanning = false;
  notifyNewFinds(offers, visibleSales(settings), settings);
  broadcast();
}

function schedule(): void {
  if (scanTimer) {
    clearInterval(scanTimer);
  }
  const ms = Math.max(settings.scanIntervalMinutes, 15) * 60 * 1000;
  scanTimer = setInterval(() => {
    void scanNow();
  }, ms);
}

function isSafeSteamUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hosts = new Set(["store.steampowered.com", "partner.steamgames.com"]);
    return parsed.protocol === "https:" && hosts.has(parsed.hostname);
  } catch {
    return false;
  }
}

function registerIpc(): void {
  ipcMain.handle("settings:get", () => settings);
  ipcMain.handle("settings:set", async (_event, patch: Partial<Settings>) => {
    const previous = settings;
    settings = sanitizeSettings({ ...settings, ...patch });
    saveSettings(settings);
    applyStartupSetting();
    schedule();
    broadcast();
    if (
      previous.countryCode !== settings.countryCode ||
      previous.freeGameMonitoring !== settings.freeGameMonitoring ||
      previous.smallerPromotions !== settings.smallerPromotions
    ) {
      void scanNow();
    }
    return settings;
  });
  ipcMain.handle("deals:get", () =>
    offers.map((offer) => ({
      ...offer,
      wishlisted: wishlistIds.has(String(offer.appId)),
      claimed: claimedIds.has(String(offer.appId)),
    })),
  );
  ipcMain.handle("wishlist:get", () => Array.from(wishlistIds));
  ipcMain.handle("wishlist:metadata", () => Array.from(resolvedWishlistItems.values()));
  ipcMain.handle("wishlist:import", async (_event, profile: string) => {
    // profile can be a numeric steamid64, a vanity name, or a path fragment
    const cleaned = String(profile).trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
    const candidates: string[] = [];
    // If user pasted a full store URL, try to normalize
    if (cleaned.includes("store.steampowered.com")) {
      // try to extract the /wishlist/... part
      const m = cleaned.match(/(store\.steampowered\.com\/wishlist\/(profiles|id)\/[^\/]+)\/?.*/i);
      if (m) {
        candidates.push(`https://${m[1]}/`);
      }
    }
    // Try /id/ first (works for both steamid64 and vanity names)
    candidates.push(`https://store.steampowered.com/wishlist/id/${cleaned}/`);
    // Then try /profiles/ (only works for steamid64)
    candidates.push(`https://store.steampowered.com/wishlist/profiles/${cleaned}/`);
    // Also try the /wishlistdata/ endpoints as fallback (rarely work anymore)
    candidates.push(`https://store.steampowered.com/wishlist/id/${cleaned}/wishlistdata/`);
    candidates.push(`https://store.steampowered.com/wishlist/profiles/${cleaned}/wishlistdata/`);

    // Helper function to validate wishlist HTML
    function isWishlistPage(text: string): boolean {
      // Check for wishlist-specific indicators
      const hasWishlistClass = /class="[^"]*wishlist[^"]*"/.test(text);
      const hasWishlistId = /id="[^"]*wishlist[^"]*"/.test(text);
      const hasWishlistTitle = /<title[^>]*>[^<]*wishlist[^<]*<\/title>/i.test(text);
      const hasAddToWishlistButton = /add_to_wishlist|remove_from_wishlist|wishlist_btn/i.test(text);

      return hasWishlistClass || hasWishlistId || hasWishlistTitle || hasAddToWishlistButton;
    }

    const tried: string[] = [];
    for (const url of candidates) {
      try {
        tried.push(url);
        // Ask for JSON-like response and include Referer + X-Requested-With to mimic browser AJAX
        const { text, contentType, finalUrl } = await fetchText(url, {
          Referer: "https://store.steampowered.com",
          Accept: "application/json, text/javascript, */*; q=0.01",
          "X-Requested-With": "XMLHttpRequest",
        });

        console.log(`[Wishlist Import] Trying ${url}, final URL: ${finalUrl}, got ${text.length} bytes, content-type: ${contentType}`);

        // Check for redirects that indicate failure
        if (finalUrl !== url && !finalUrl.includes("/wishlist/")) {
          console.log(`[Wishlist Import] ? REJECTED: Redirected from ${url} to ${finalUrl}`);
          continue;
        }

        // 1) Try direct JSON parse - but validate that keys are numeric app IDs
        try {
          const parsed = JSON.parse(text) as Record<string, unknown>;
          if (parsed && typeof parsed === "object") {
            const keys = Object.keys(parsed);
            console.log(`[Wishlist Import] Parsed JSON with ${keys.length} keys, first 5: ${keys.slice(0, 5).join(", ")}`);
            // Wishlist JSON should have ONLY numeric keys (app IDs), not mixed
            const numericKeys = keys.filter((k) => /^\d+$/.test(k) && parseInt(k, 10) < 2_000_000_000);

            if (numericKeys.length === keys.length && numericKeys.length >= 5) {
              const ids = numericKeys;
              console.log(`[Wishlist Import] ? SUCCESS: Found ${ids.length} items via direct JSON parse from ${url}`);
              wishlistIds = new Set(ids);
              saveWishlist(Array.from(wishlistIds));
              const metadata = await resolveWishlistMetadata(ids, settings.countryCode);
              resolvedWishlistItems = new Map(metadata.map((m) => [m.appId, {
                ...m,
                isDiscounted: m.discountPercent > 0,
                isFree: m.currentCents === 0,
              }]));
              broadcast();
              return Array.from(wishlistIds);
            } else if (numericKeys.length > 0) {
              console.log(`[Wishlist Import] ? REJECTED JSON: ${numericKeys.length} numeric / ${keys.length} total. Non-numeric: ${keys.filter((k) => !/^\d+$/.test(k)).slice(0, 5).join(", ")}`);
            }
          }
        } catch (e) {
          console.log(`[Wishlist Import] JSON parse failed: ${(e as Error).message.substring(0, 50)}`);
        }

        // 2) Look for g_rgWishlistData variable in the HTML/JS
        const assignMatch = text.match(/g_rgWishlistData\s*=\s*(\{[\s\S]*?\})\s*;/);
        if (assignMatch && assignMatch[1]) {
          // Only accept if this looks like a wishlist page
          if (!isWishlistPage(text)) {
            console.log(`[Wishlist Import] ? REJECTED g_rgWishlistData: Page doesn't contain wishlist indicators`);
          } else {
            try {
              const parsed = JSON.parse(assignMatch[1]) as Record<string, unknown>;
              const keys = Object.keys(parsed);
              console.log(`[Wishlist Import] Found g_rgWishlistData with ${keys.length} keys`);
              const numericKeys = keys.filter((k) => /^\d+$/.test(k) && parseInt(k, 10) < 2_000_000_000);
              if (numericKeys.length === keys.length && numericKeys.length >= 5) {
                const ids = numericKeys;
                console.log(`[Wishlist Import] ? SUCCESS: Found ${ids.length} items via g_rgWishlistData from ${url}`);
                wishlistIds = new Set(ids);
                saveWishlist(Array.from(wishlistIds));
                const metadata = await resolveWishlistMetadata(ids, settings.countryCode);
                resolvedWishlistItems = new Map(metadata.map((m) => [m.appId, {
                  ...m,
                  isDiscounted: m.discountPercent > 0,
                  isFree: m.currentCents === 0,
                }]));
                broadcast();
                return Array.from(wishlistIds);
              }
            } catch (e) {
              console.log(`[Wishlist Import] g_rgWishlistData parse failed`);
            }
          }
        }

        // 3) Look for wishlist items in data attributes (React/modern Steam uses data-ds-appid)
        // ONLY accept if page contains wishlist-specific markers
        if (!isWishlistPage(text)) {
          console.log(`[Wishlist Import] ? REJECTED data-ds-appid: Page doesn't contain wishlist indicators (likely homepage or unrelated page)`);
        } else {
          // Extract all app IDs from data-ds-appid attributes
          const appIdMatches = text.match(/data-ds-appid="(\d+)"/g);
          if (appIdMatches && appIdMatches.length > 0) {
            const idsFound = new Set<string>();
            for (const match of appIdMatches) {
              const idMatch = match.match(/data-ds-appid="(\d+)"/);
              if (idMatch && idMatch[1]) {
                const id = idMatch[1];
                const numId = parseInt(id, 10);
                // Only accept valid Steam app IDs
                if (numId > 0 && numId < 2_000_000_000) {
                  idsFound.add(id);
                }
              }
            }
            if (idsFound.size >= 5) {
              const ids = Array.from(idsFound);
              console.log(`[Wishlist Import] ? SUCCESS: Found ${ids.length} items via data-ds-appid from ${url}`);
              wishlistIds = new Set(ids);
              saveWishlist(Array.from(wishlistIds));
              const metadata = await resolveWishlistMetadata(ids, settings.countryCode);
              resolvedWishlistItems = new Map(metadata.map((m) => [m.appId, {
                ...m,
                isDiscounted: m.discountPercent > 0,
                isFree: m.currentCents === 0,
              }]));
              broadcast();
              return Array.from(wishlistIds);
            } else if (idsFound.size > 0) {
              console.log(`[Wishlist Import] Found only ${idsFound.size} items via data-ds-appid (need 5+), trying next method`);
            }
          }
        }
      } catch (err) {
        console.log(`[Wishlist Import] Error processing ${url}: ${(err as Error).message}`);
      }
    }
    throw new Error(
      `Unable to import wishlist. Tried: ${tried.join(", ")}. Ensure the profile is correct and the wishlist is public.`,
    );
  });
  ipcMain.handle("wishlist:add", (_event, appId: number) => {
    wishlistIds.add(String(appId));
    saveWishlist(Array.from(wishlistIds));
    broadcast();
    return Array.from(wishlistIds);
  });
  ipcMain.handle("wishlist:remove", (_event, appId: number) => {
    wishlistIds.delete(String(appId));
    saveWishlist(Array.from(wishlistIds));
    broadcast();
    return Array.from(wishlistIds);
  });
  ipcMain.handle("deals:scan", async () => {
    await scanNow();
  });
  ipcMain.handle("sales:get", () => visibleSales(settings));
  ipcMain.handle("scan:status", () => status);
  ipcMain.handle("shell:open", async (_event, url: string) => {
    if (!isSafeSteamUrl(url)) {
      return false;
    }
    await shell.openExternal(url);
    return true;
  });
  ipcMain.handle("claimed:get", () => Array.from(claimedIds));
  ipcMain.handle("claimed:mark", (_event, appId: number) => {
    claimedIds.add(String(appId));
    saveClaimed(Array.from(claimedIds));
    broadcast();
    return Array.from(claimedIds);
  });
  ipcMain.handle("claimed:unmark", (_event, appId: number) => {
    claimedIds.delete(String(appId));
    saveClaimed(Array.from(claimedIds));
    broadcast();
    return Array.from(claimedIds);
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => showWindow());
  app.whenReady().then(() => {
    if (Notification.isSupported()) {
      app.setAppUserModelId("com.steamdealradar.app");
    }
    settings = loadSettings();
    wishlistIds = new Set(loadWishlist());
    claimedIds = new Set(loadClaimed());
    applyStartupSetting();
    registerIpc();
    createWindow();
    createTray();
    schedule();
    void scanNow();
  });
}

app.on("before-quit", () => {
  quitting = true;
});

app.on("window-all-closed", () => {
  if (quitting) {
    app.quit();
  }
});
