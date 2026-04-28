/**
 * @file Process-local cache for server-side API routes.
 *
 * Centralises the in-memory caching pattern used by the activity,
 * prompts, tools, and users routes so they share the same TTL,
 * tag-based invalidation, and singleflight (cold-cache stampede)
 * protection.
 *
 * ## Why not `unstable_cache`?
 *
 * Next 15+'s `unstable_cache` is the official modern primitive, but
 * it doesn't fit cleanly here:
 *
 * - Our cached data is **per signed-in caller** (user OAuth token or
 *   service account). `unstable_cache` keys by `keyParts + JSON.stringify(args)`,
 *   so we'd have to pass the access token as an argument. Either it
 *   ends up in the cache key (rotates → cache thrash), or we side-
 *   channel it through a Map (race-prone, error-leaky).
 * - Our caches must drop on auth-failure paths and rotate on
 *   sign-out. The simple Map below makes that an obvious one-liner.
 *
 * If/when the educational POC grows multi-process, swap the underlying
 * `Map` for Redis or memcached behind the same `getOrFetch` /
 * `invalidateByTag` API; callers don't need to change.
 *
 * This module is server-only by convention. We don't import the
 * `server-only` package because vitest's node environment doesn't set
 * the `react-server` export condition, so it would throw in tests.
 * The route handlers (the only consumers) live under `src/app/api/`,
 * which Next never bundles into the client.
 */

/**
 * Coarse tag namespaces for grouped invalidation. Sign-out, "Check
 * again", or admin-driven refresh flows can call `invalidateByTag` to
 * wipe related entries in one call.
 */
export const CACHE_TAGS = {
  USERS: "users",
  ACTIVITY: "activity",
  TOOLS: "tools",
  PROMPTS: "prompts",
} as const;

/**
 * One of the values in {@link CACHE_TAGS}. Restricting tags to a
 * known set prevents typos at call sites — passing an unknown string
 * is a compile error.
 */
export type CacheTag = (typeof CACHE_TAGS)[keyof typeof CACHE_TAGS];

type CacheEntry<T> = {
  data: T;
  expiresAt: number;
  tags: ReadonlyArray<CacheTag>;
};

/**
 * Process-local store. A single `Map` is enough — the cache is small
 * (handfuls of keys per session) and lookup is O(1). Entries are
 * removed by TTL on the read path (see {@link getOrFetch}) and by
 * tag on `invalidateByTag`.
 */
const store = new Map<string, CacheEntry<unknown>>();

/**
 * In-flight requests, keyed by cache key. Used for singleflight: when
 * a cold-cache miss is already being fetched, concurrent callers
 * await the same promise instead of each firing their own upstream
 * request. Cleared on resolve/reject so a transient error doesn't
 * pin a permanent in-flight entry.
 */
const inflight = new Map<string, Promise<unknown>>();

/**
 * Options accepted by {@link getOrFetch}.
 */
export type GetOrFetchOptions<T> = {
  /** Globally unique cache key. Combine the namespace + caller + variant. */
  key: string;
  /** TTL in milliseconds. After this, the next read triggers a refresh. */
  ttlMs: number;
  /** One or more tags for grouped invalidation via {@link invalidateByTag}. */
  tags: ReadonlyArray<CacheTag>;
  /** Async fetcher run on cache miss. Result is stored under `key`. */
  fetcher: () => Promise<T>;
};

/**
 * Returns the cached value for `key` if fresh, otherwise runs the
 * fetcher and caches the result. Concurrent callers with the same
 * key share one upstream request (singleflight).
 *
 * If the fetcher throws, the entry is *not* cached — the next call
 * tries again. This matches the existing route behaviour where
 * transient failures should not be sticky.
 */
export async function getOrFetch<T>(opts: GetOrFetchOptions<T>): Promise<T> {
  const now = Date.now();
  const entry = store.get(opts.key) as CacheEntry<T> | undefined;
  if (entry && entry.expiresAt > now) {
    return entry.data;
  }

  const existing = inflight.get(opts.key) as Promise<T> | undefined;
  if (existing) return existing;

  const promise = (async () => {
    try {
      const data = await opts.fetcher();
      store.set(opts.key, { data, expiresAt: Date.now() + opts.ttlMs, tags: opts.tags });
      return data;
    } finally {
      inflight.delete(opts.key);
    }
  })();

  inflight.set(opts.key, promise);
  return promise;
}

/**
 * Drops every cache entry tagged with `tag`. In-flight requests are
 * left to complete (their results land in the cleared cache and are
 * naturally evicted by the next call's TTL check).
 */
export function invalidateByTag(tag: CacheTag): void {
  for (const [key, entry] of store.entries()) {
    if (entry.tags.includes(tag)) store.delete(key);
  }
}

/**
 * Clears the entire cache. Intended for tests and dev tooling — the
 * route handlers should use {@link invalidateByTag} for surgical
 * invalidation instead.
 */
export function clearCache(): void {
  store.clear();
  inflight.clear();
}
