import type { SteamDealRadarApi } from "../shared/api";

declare global {
  interface Window {
    steamDealRadar: SteamDealRadarApi;
  }
}

export {};
