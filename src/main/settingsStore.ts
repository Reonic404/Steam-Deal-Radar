import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { DEFAULT_SETTINGS } from "../shared/defaults";
import type { Settings, ThemeId } from "../shared/types";

const THEMES: ThemeId[] = ["midnight", "ember", "forest", "violet"];

function filePath(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function loadSettings(): Settings {
  try {
    const raw = fs.readFileSync(filePath(), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!isObject(parsed)) {
      return { ...DEFAULT_SETTINGS };
    }
    return sanitizeSettings(parsed);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  fs.mkdirSync(path.dirname(filePath()), { recursive: true });
  fs.writeFileSync(filePath(), JSON.stringify(settings, null, 2), "utf8");
}

export function sanitizeSettings(input: Record<string, unknown>): Settings {
  const theme = THEMES.includes(input.theme as ThemeId)
    ? (input.theme as ThemeId)
    : DEFAULT_SETTINGS.theme;
  const interval = Number(input.scanIntervalMinutes);
  const country =
    typeof input.countryCode === "string" && /^[A-Za-z]{2}$/.test(input.countryCode)
      ? input.countryCode.toUpperCase()
      : DEFAULT_SETTINGS.countryCode;

  return {
    freeGameMonitoring: bool(input.freeGameMonitoring, DEFAULT_SETTINGS.freeGameMonitoring),
    majorSalesMonitoring: bool(input.majorSalesMonitoring, DEFAULT_SETTINGS.majorSalesMonitoring),
    smallerPromotions: bool(input.smallerPromotions, DEFAULT_SETTINGS.smallerPromotions),
    desktopNotifications: bool(input.desktopNotifications, DEFAULT_SETTINGS.desktopNotifications),
    notificationSound: bool(input.notificationSound, DEFAULT_SETTINGS.notificationSound),
    startWithWindows: bool(input.startWithWindows, DEFAULT_SETTINGS.startWithWindows),
    scanIntervalMinutes: [15, 30, 60, 180].includes(interval)
      ? interval
      : DEFAULT_SETTINGS.scanIntervalMinutes,
    theme,
    reducedMotion: bool(input.reducedMotion, DEFAULT_SETTINGS.reducedMotion),
    countryCode: country,
    filterStores: Array.isArray(input.filterStores)
      ? (input.filterStores as unknown[]).map(String)
      : DEFAULT_SETTINGS.filterStores,
    filterTypes: Array.isArray(input.filterTypes)
      ? (input.filterTypes as unknown[]).map(String)
      : DEFAULT_SETTINGS.filterTypes,
    hideClaimed: bool(input.hideClaimed, DEFAULT_SETTINGS.hideClaimed),
    hideDlcs: bool(input.hideDlcs, DEFAULT_SETTINGS.hideDlcs),
  };
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}
