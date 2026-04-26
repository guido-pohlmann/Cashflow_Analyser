import { Redis } from "@upstash/redis";

interface MemoryEntry<T> {
  value: T;
  expiresAt: number;
}

const memoryStore = new Map<string, MemoryEntry<unknown>>();

let redisInstance: Redis | null = null;
let redisProbed = false;

function getRedis(): Redis | null {
  if (redisProbed) return redisInstance;
  redisProbed = true;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    console.warn(
      "[cache] UPSTASH_REDIS_REST_URL/TOKEN fehlt — In-Memory-Fallback aktiv.",
    );
    return null;
  }
  redisInstance = new Redis({ url, token });
  return redisInstance;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const r = getRedis();
  if (r) {
    return ((await r.get(key)) as T | null) ?? null;
  }
  const entry = memoryStore.get(key) as MemoryEntry<T> | undefined;
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    memoryStore.delete(key);
    return null;
  }
  return entry.value;
}

export async function cachePut<T>(
  key: string,
  value: T,
  ttlSeconds: number,
): Promise<void> {
  const r = getRedis();
  if (r) {
    await r.set(key, value as unknown as string, { ex: ttlSeconds });
    return;
  }
  memoryStore.set(key, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

// Tests-only helper.
export function _resetMemoryCache(): void {
  memoryStore.clear();
  redisInstance = null;
  redisProbed = false;
}
