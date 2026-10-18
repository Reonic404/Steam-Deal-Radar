export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 SteamDealRadar/0.1";

export class HttpError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function fetchText(
  url: string,
  extraHeaders: Record<string, string> = {},
): Promise<{ text: string; contentType: string; finalUrl: string }> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      ...extraHeaders,
    },
  });
  if (response.status === 429) {
    throw new HttpError("Steam rate-limited the request. Try again in a few minutes.", 429);
  }
  if (!response.ok) {
    throw new HttpError(`Request failed (${response.status}) for ${url}`, response.status);
  }
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();
  return { text, contentType, finalUrl: response.url };
}

export async function fetchJson<T>(url: string): Promise<{ data: T; finalUrl: string }> {
  const { text, contentType, finalUrl } = await fetchText(url, { Accept: "application/json" });
  if (!contentType.includes("json") && !text.trim().startsWith("{") && !text.trim().startsWith("[")) {
    throw new Error("Expected JSON but received another format.");
  }
  return { data: JSON.parse(text) as T, finalUrl };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function mapPool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function run(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => run());
  await Promise.all(workers);
  return results;
}
