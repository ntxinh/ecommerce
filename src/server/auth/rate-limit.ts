import "server-only";

// ponytail: in-memory sliding window — per-process only, swap for a shared store if multi-instance.
const buckets = new Map<string, number[]>();

export function checkRateLimit(key: string, limit: number, windowSec: number): boolean {
  const cutoff = Date.now() - windowSec * 1000;
  const hits = (buckets.get(key) ?? []).filter((t) => t > cutoff);
  if (hits.length === 0)
    buckets.delete(key); // prune fully-expired keys
  else if (hits.length >= limit) {
    buckets.set(key, hits);
    return false;
  }
  hits.push(Date.now());
  buckets.set(key, hits);
  return true;
}
