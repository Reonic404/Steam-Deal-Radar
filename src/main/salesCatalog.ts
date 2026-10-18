import type { MajorSale } from "../shared/types";
import catalog from "./data/major-sales.json";

interface CatalogFile {
  updatedAt: string;
  events: MajorSale[];
}

const data = catalog as CatalogFile;

export function listSales(includeFests: boolean): MajorSale[] {
  return data.events
    .filter((event) => includeFests || event.kind === "seasonal")
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
}

export function catalogUpdatedAt(): string {
  return data.updatedAt;
}

export function salePhase(sale: MajorSale, now = Date.now()): "upcoming" | "active" | "ended" {
  const start = Date.parse(sale.startAt);
  const end = Date.parse(sale.endAt);
  if (now < start) {
    return "upcoming";
  }
  if (now > end) {
    return "ended";
  }
  return "active";
}
