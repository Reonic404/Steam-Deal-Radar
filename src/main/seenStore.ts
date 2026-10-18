import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

export interface SeenState {
  offerIds: string[];
  saleNotices: Record<string, string>;
}

function filePath(): string {
  return path.join(app.getPath("userData"), "seen-offers.json");
}

export function loadSeen(): SeenState {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath(), "utf8")) as SeenState;
    return {
      offerIds: Array.isArray(parsed.offerIds) ? parsed.offerIds.map(String) : [],
      saleNotices: parsed.saleNotices && typeof parsed.saleNotices === "object" ? parsed.saleNotices : {},
    };
  } catch {
    return { offerIds: [], saleNotices: {} };
  }
}

export function saveSeen(state: SeenState): void {
  fs.mkdirSync(path.dirname(filePath()), { recursive: true });
  fs.writeFileSync(filePath(), JSON.stringify(state, null, 2), "utf8");
}
