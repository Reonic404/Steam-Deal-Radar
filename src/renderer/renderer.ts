import type { FreeOffer, MajorSale, ScanStatus, Settings, WishlistItem } from "../shared/types";

const api: any = (globalThis as any)["steamDealRadar"];
const titles: Record<string, [string, string]> = {
  overview: ["Overview", "Live Steam 100% off promotions for your region."],
  free: ["Free Games", "Temporary free-to-keep offers. Demos and permanent F2P are filtered out."],
  sales: ["Major Sales", "Verified seasonal windows from the Steamworks catalog."],
  wishlist: ["Wishlist", "This section is under construction."],
  settings: ["Settings", "Every toggle changes real behavior except the unfinished wishlist."],
};

let settings: Settings | null = null;
let offers: FreeOffer[] = [];
let sales: MajorSale[] = [];
let status: ScanStatus | null = null;
let wishlistIds: Set<string> = new Set();
let claimedIds: Set<string> = new Set();
let resolvedWishlist: WishlistItem[] = [];
let wishlistOnlyDiscounted = false;

function $(selector: string): HTMLElement {
  const node = document.querySelector(selector);
  if (!node) {
    throw new Error(`Missing ${selector}`);
  }
  return node as HTMLElement;
}

function applyChrome(): void {
  if (!settings) {
    return;
  }
  document.documentElement.dataset.theme = settings.theme;
  document.documentElement.dataset.reduced = String(settings.reducedMotion);
  const form = document.getElementById("settings-form") as HTMLFormElement;
  const named = form.elements;
  (named.namedItem("freeGameMonitoring") as HTMLInputElement).checked = settings.freeGameMonitoring;
  (named.namedItem("majorSalesMonitoring") as HTMLInputElement).checked = settings.majorSalesMonitoring;
  (named.namedItem("smallerPromotions") as HTMLInputElement).checked = settings.smallerPromotions;
  (named.namedItem("desktopNotifications") as HTMLInputElement).checked = settings.desktopNotifications;
  (named.namedItem("notificationSound") as HTMLInputElement).checked = settings.notificationSound;
  (named.namedItem("startWithWindows") as HTMLInputElement).checked = settings.startWithWindows;
  (named.namedItem("reducedMotion") as HTMLInputElement).checked = settings.reducedMotion;
  (named.namedItem("scanIntervalMinutes") as HTMLSelectElement).value = String(settings.scanIntervalMinutes);
  (named.namedItem("countryCode") as HTMLSelectElement).value = settings.countryCode;
  (named.namedItem("theme") as HTMLSelectElement).value = settings.theme;
  (named.namedItem("hideClaimed") as HTMLInputElement).checked = settings.hideClaimed;
}

function renderStatus(): void {
  if (!status || !settings) {
    return;
  }
  $("#sidebar-status").textContent = status.scanning
    ? "Scanning…"
    : status.lastError
      ? "Scan issue"
      : status.sourceLabel;
  $("#stat-count").textContent = String(status.offerCount);
  $("#stat-monitor").textContent = settings.freeGameMonitoring ? "On" : "Off";
  $("#stat-last").textContent = status.lastSuccessAt
    ? new Date(status.lastSuccessAt).toLocaleString()
    : "Never";
  $("#limitations").textContent = status.limitations;
  const error = $("#overview-error");
  if (status.lastError) {
    error.hidden = false;
    error.textContent = status.lastError;
  } else {
    error.hidden = true;
  }
  const check = $("#check-now") as HTMLButtonElement;
  check.disabled = status.scanning;
  check.textContent = status.scanning ? "Checking…" : "Check Now";
}

function offerCard(offer: FreeOffer, highlight = false): string {
  const art = offer.headerImage
    ? `<img src="${escapeAttr(offer.headerImage)}" alt="" />`
    : `<div class="missing"></div>`;
  const badges = [
    offer.isDlc ? `<span class="badge">DLC</span>` : "",
    `<span class="badge">${escapeHtml(offer.type)}</span>`,
    `<span class="badge">${escapeHtml(offer.source)}</span>`,
  ].join("");
  const expires = offer.expiresAt
    ? `Ends ${escapeHtml(new Date(offer.expiresAt).toLocaleString())}`
    : "Expiration unknown";
  return `<article class="game-card${highlight ? " new" : ""}">
    ${art}
    <div class="body">
      <h3>${escapeHtml(offer.title)}</h3>
      <div>${badges}</div>
      <div class="prices">
        <span class="old">${escapeHtml(offer.originalPriceLabel)}</span>
        <span class="now">${escapeHtml(offer.currentPriceLabel)}</span>
      </div>
      <small>${expires}</small>
      <div class="card-actions">
        <button class="ghost" data-open="${escapeAttr(offer.storeUrl)}">Open on Steam</button>
        <button class="ghost" data-wishlist="${escapeAttr(String(offer.appId))}">${offer.wishlisted ? "In wishlist" : "Add to wishlist"}</button>
        <button class="ghost" data-claim="${escapeAttr(String(offer.appId))}">${offer.claimed ? "Claimed" : "Mark claimed"}</button>
      </div>
    </div>
  </article>`;
}

function wishlistItemCard(item: WishlistItem): string {
  const art = item.headerImage
    ? `<img src="${escapeAttr(item.headerImage)}" alt="" />`
    : `<div class="missing"></div>`;
  const discountBadge = item.isDiscounted ? `<span class="badge discount">-${item.discountPercent}%</span>` : "";
  const freeBadge = item.isFree ? `<span class="badge free">FREE</span>` : "";
  const errorBadge = item.resolveError ? `<span class="badge">Not resolved</span>` : "";
  const badges = [discountBadge, freeBadge, errorBadge].filter(Boolean).join("");
  return `<article class="game-card${item.isFree ? " free-item" : ""}${item.isDiscounted ? " discounted-item" : ""}">
    ${art}
    <div class="body">
      <h3>${escapeHtml(item.title)}</h3>
      <div>${badges}</div>
      <div class="prices">
        <span class="old">${escapeHtml(item.originalPriceLabel)}</span>
        <span class="now">${escapeHtml(item.currentPriceLabel)}</span>
      </div>
      <div class="card-actions">
        <button class="ghost" data-open="${escapeAttr(item.storeUrl)}">Open on Steam</button>
        <button class="ghost" data-wishlist="${escapeAttr(String(item.appId))}">Remove from wishlist</button>
      </div>
    </div>
  </article>`;
}

function renderOffers(): void {
  if (!settings) return;
  const list = offers.filter((offer) => {
    if (settings.hideClaimed && offer.claimed) return false;
    if (settings.hideDlcs && offer.isDlc) return false;
    if (settings.filterStores.length > 0 && !settings.filterStores.includes(offer.source)) return false;
    if (settings.filterTypes.length > 0 && !settings.filterTypes.includes(offer.type)) return false;
    return true;
  });
  $("#overview-cards").innerHTML = list.slice(0, 6).map((offer) => offerCard(offer, true)).join("") ||
    `<p class="muted">Nothing to show until a successful scan finds a 100% off promotion.</p>`;
  $("#free-cards").innerHTML = list.map((offer) => offerCard(offer)).join("");
  $("#free-empty").hidden = list.length > 0;
}

function renderWishlist(): void {
  const container = $("#wishlist-list");
  const cards: string[] = [];

  for (const item of resolvedWishlist) {
    // Skip items that failed to resolve or are not actual games
    if (item.resolveError) {
      continue;
    }

    if (wishlistOnlyDiscounted && !item.isDiscounted) {
      continue;
    }
    cards.push(wishlistItemCard(item));
  }

  // Show unresolved items only if there are no resolved items
  if (cards.length === 0 && resolvedWishlist.length > 0) {
    // All items failed to resolve - show count of problematic items
    const failedCount = resolvedWishlist.filter((i) => i.resolveError).length;
    cards.push(
      `<div style="grid-column: 1/-1; padding: 16px; text-align: center; color: var(--muted);">` +
      `<p>${failedCount} item(s) could not be resolved (may be demos, bundles, or events)</p>` +
      `</div>`
    );
  }

  container.innerHTML = cards.join("");
  $("#wishlist-empty").hidden = cards.length > 0;
}

function renderSales(): void {
  const now = Date.now();
  $("#sale-list").innerHTML = sales
    .map((sale) => {
      const start = Date.parse(sale.startAt);
      const end = Date.parse(sale.endAt);
      let phase = "Upcoming";
      if (now > end) {
        phase = "Ended";
      } else if (now >= start) {
        phase = "Active";
      }
      return `<article class="sale-card">
        <div>
          <h3>${escapeHtml(sale.name)}</h3>
          <p>${escapeHtml(sale.kind)} · ${escapeHtml(phase)}</p>
          <p>${new Date(sale.startAt).toLocaleString()} – ${new Date(sale.endAt).toLocaleString()}</p>
          <small>${escapeHtml(sale.timezoneNote)}</small>
        </div>
        <a href="${escapeAttr(sale.sourceUrl)}" data-doc>${escapeHtml(sale.sourceName)}</a>
      </article>`;
    })
    .join("");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}

function showPage(id: string): void {
  document.querySelectorAll(".page").forEach((page) => page.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach((btn) => btn.classList.remove("active"));
  $(`#page-${id}`).classList.add("active");
  document.querySelector(`[data-page="${id}"]`)?.classList.add("active");
  const [title, subtitle] = titles[id] ?? titles.overview;
  $("#page-title").textContent = title;
  $("#page-subtitle").textContent = subtitle;
}

async function boot(): Promise<void> {
  settings = await api.getSettings();
  offers = await api.getDeals();
  sales = await api.getSales();
  status = await api.getStatus();
  applyChrome();
  renderStatus();
  renderOffers();
  renderSales();

  document.querySelectorAll(".nav-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const id = (button as HTMLButtonElement).dataset.page;
      if (id && !(button as HTMLButtonElement).disabled) {
        showPage(id);
      }
    });
  });

  $("#check-now").addEventListener("click", () => {
    void api.scanNow();
  });

  document.body.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const open = target.closest("[data-open]") as HTMLElement | null;
    if (open?.dataset.open) {
      void api.openExternal(open.dataset.open);
    }
    const doc = target.closest("a[data-doc]") as HTMLAnchorElement | null;
    if (doc) {
      event.preventDefault();
      const href = doc.getAttribute("href") ?? "";
      void api.openExternal(href);
    }
    const wishlistBtn = target.closest("[data-wishlist]") as HTMLElement | null;
    if (wishlistBtn && wishlistBtn.dataset.wishlist) {
      const id = Number(wishlistBtn.dataset.wishlist);
      if (wishlistIds.has(String(id))) {
        void api.removeWishlist(id).then((next) => {
          wishlistIds = new Set(next);
          renderOffers();
          renderWishlist();
        });
      } else {
        void api.addWishlist(id).then((next) => {
          wishlistIds = new Set(next);
          renderOffers();
          renderWishlist();
        });
      }
    }
    const claimBtn = target.closest("[data-claim]") as HTMLElement | null;
    if (claimBtn && claimBtn.dataset.claim) {
      const id = Number(claimBtn.dataset.claim);
      if (claimedIds.has(String(id))) {
        void api.unmarkClaimed(id).then((next) => {
          claimedIds = new Set(next);
          renderOffers();
          renderWishlist();
        });
      } else {
        void api.markClaimed(id).then((next) => {
          claimedIds = new Set(next);
          renderOffers();
          renderWishlist();
        });
      }
    }
    const importBtn = target.closest("#import-wishlist") as HTMLElement | null;
    if (importBtn) {
      const input = document.getElementById("wishlist-profile") as HTMLInputElement;
      const result = document.getElementById("import-result") as HTMLElement;
      result.textContent = "Importing…";
      void api.importWishlist(input.value).then((list: string[]) => {
        wishlistIds = new Set(list);
        renderWishlist();
        renderOffers();
        showPage("wishlist");
        result.textContent = `Imported ${list.length} items`;
      }).catch((err: Error) => {
        result.textContent = err.message || "Import failed";
      });
    }
  });

  const form = $("#settings-form") as HTMLFormElement;
  form.addEventListener("change", async () => {
    const data = new FormData(form);
    settings = await api.setSettings({
      freeGameMonitoring: data.get("freeGameMonitoring") === "on",
      majorSalesMonitoring: data.get("majorSalesMonitoring") === "on",
      smallerPromotions: data.get("smallerPromotions") === "on",
      desktopNotifications: data.get("desktopNotifications") === "on",
      notificationSound: data.get("notificationSound") === "on",
      startWithWindows: data.get("startWithWindows") === "on",
      reducedMotion: data.get("reducedMotion") === "on",
      scanIntervalMinutes: Number(data.get("scanIntervalMinutes")),
      countryCode: String(data.get("countryCode")),
      theme: String(data.get("theme")) as Settings["theme"],
      hideClaimed: data.get("hideClaimed") === "on",
    });
    applyChrome();
    renderStatus();
  });

  // Search form logic (separate page)
  const searchForm = $("#search-form") as HTMLFormElement | null;
  if (searchForm) {
    const apply = $("#apply-search") as HTMLButtonElement;
    apply.addEventListener("click", async (ev) => {
      ev.preventDefault();
      const data = new FormData(searchForm);
      const stores = (Array.from((searchForm.elements.namedItem("filterStores") as HTMLSelectElement).selectedOptions) || [])
        .map((o) => o.value);
      const types = String(data.get("filterTypes") || "").split(",").map((s) => s.trim()).filter(Boolean);
      const hideDlcs = data.get("hideDlcs") === "on";
      settings = await api.setSettings({ filterStores: stores, filterTypes: types, hideDlcs });
      applyChrome();
      renderOffers();
      showPage("free");
    });
    // populate initial values
    (searchForm.elements.namedItem("hideDlcs") as HTMLInputElement).checked = settings.hideDlcs;
    const storesSel = searchForm.elements.namedItem("filterStores") as HTMLSelectElement;
    Array.from(storesSel.options).forEach((opt) => {
      opt.selected = settings.filterStores.includes(opt.value);
    });
    (searchForm.elements.namedItem("filterTypes") as HTMLInputElement).value = settings.filterTypes.join(",");
  }

  api.onStatus((next) => {
    status = next;
    renderStatus();
  });
  api.onDeals((next) => {
    offers = next;
    // keep flags consistent with local persisted wishlist/claimed
    offers.forEach((o) => {
      o.wishlisted = wishlistIds.has(String(o.appId));
      o.claimed = claimedIds.has(String(o.appId));
    });
    renderOffers();
    renderWishlist();
  });
  api.onSales((next) => {
    sales = next;
    renderSales();
  });
  api.onWishlist((items) => {
    resolvedWishlist = items;
    renderWishlist();
  });
  // load persisted lists
  wishlistIds = new Set(await api.getWishlist());
  resolvedWishlist = await api.getWishlistMetadata();
  claimedIds = new Set(await api.getClaimed());
  renderWishlist();
  // wishlist-only-discounted checkbox wiring
  const onlyDiscounted = document.getElementById("wishlist-only-discounted") as HTMLInputElement | null;
  if (onlyDiscounted) {
    onlyDiscounted.checked = false;
    onlyDiscounted.addEventListener("change", () => {
      wishlistOnlyDiscounted = onlyDiscounted.checked;
      renderWishlist();
    });
  }
}

void boot();
