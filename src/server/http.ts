export const USER_AGENT = "game-search/0.1 (+https://github.com/stfrigerio/game-search)";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET a JSON document, retrying with backoff on network errors, 429 and 5xx. */
export async function fetchJson<T>(url: string, { retries = 4, timeoutMs = 60_000 } = {}): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(1000 * 2 ** attempt);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) return (await res.json()) as T;
      lastError = new Error(`HTTP ${res.status} for ${url}`);
      if (res.status !== 429 && res.status < 500) break;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

/** Run `worker` over `items` with at most `concurrency` in flight; results keep input order. */
export async function mapLimit<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}
