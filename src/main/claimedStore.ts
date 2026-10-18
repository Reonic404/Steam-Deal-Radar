import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

function filePath(): string {
  return path.join(app.getPath("userData"), "claimed.json");
}

export function loadClaimed(): string[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath(), "utf8"));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function saveClaimed(list: string[]): void {
  fs.mkdirSync(path.dirname(filePath()), { recursive: true });
  fs.writeFileSync(filePath(), JSON.stringify(Array.from(new Set(list)), null, 2), "utf8");
}
