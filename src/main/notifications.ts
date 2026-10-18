import { Notification, nativeImage } from "electron";
import path from "node:path";
import type { FreeOffer, MajorSale, Settings } from "../shared/types";
import { salePhase } from "./salesCatalog";
import { loadSeen, saveSeen, type SeenState } from "./seenStore";

const UPCOMING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function notifyNewFinds(
  offers: FreeOffer[],
  sales: MajorSale[],
  settings: Settings,
  previousSeen?: SeenState,
): SeenState {
  const seen = previousSeen ?? loadSeen();
  if (!settings.desktopNotifications) {
    const next: SeenState = {
      offerIds: offers.map((offer) => String(offer.appId)),
      saleNotices: seen.saleNotices,
    };
    saveSeen(next);
    return next;
  }

  const known = new Set(seen.offerIds);
  const fresh = offers.filter((offer) => !known.has(String(offer.appId)));
  if (settings.freeGameMonitoring && fresh.length > 0) {
    const preview = fresh.slice(0, 3).map((offer) => offer.title).join(", ");
    showNotification(
      fresh.length === 1 ? "New free Steam game" : `${fresh.length} new free Steam games`,
      preview,
      settings.notificationSound,
    );
  }

  if (settings.majorSalesMonitoring) {
    for (const sale of sales) {
      const phase = salePhase(sale);
      if (phase === "ended") {
        continue;
      }
      const start = Date.parse(sale.startAt);
      const upcomingSoon = phase === "upcoming" && start - Date.now() <= UPCOMING_WINDOW_MS;
      const key = `${sale.id}:${phase}`;
      if (seen.saleNotices[sale.id] === phase) {
        continue;
      }
      if (phase === "active") {
        showNotification("Steam sale is live", `${sale.name} is running now.`, settings.notificationSound);
        seen.saleNotices[sale.id] = phase;
      } else if (upcomingSoon) {
        showNotification("Upcoming Steam sale", `${sale.name} starts soon.`, settings.notificationSound);
        seen.saleNotices[sale.id] = phase;
      }
      void key;
    }
  }

  const next: SeenState = {
    offerIds: Array.from(new Set([...seen.offerIds, ...offers.map((offer) => String(offer.appId))])).slice(-400),
    saleNotices: seen.saleNotices,
  };
  saveSeen(next);
  return next;
}

function showNotification(title: string, body: string, sound: boolean): void {
  if (!Notification.isSupported()) {
    return;
  }
  const iconPath = path.join(__dirname, "../../build/icon.png");
  const note = new Notification({
    title,
    body,
    silent: !sound,
    icon: nativeImage.createFromPath(iconPath),
  });
  note.show();
}
