import { describe, it, expect, beforeEach, vi } from "vitest";
import { cacheGet, cachePut, _resetMemoryCache } from "@/lib/cache";

describe("cache (in-memory fallback)", () => {
  beforeEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    _resetMemoryCache();
  });

  it("returns null for unknown key", async () => {
    expect(await cacheGet("missing")).toBeNull();
  });

  it("round-trips a value", async () => {
    await cachePut("k1", { hello: "world" }, 60);
    const out = await cacheGet<{ hello: string }>("k1");
    expect(out).toEqual({ hello: "world" });
  });

  it("expires entries past TTL", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(0);
      await cachePut("k2", "value", 1);
      vi.setSystemTime(2000); // 2 s later
      expect(await cacheGet("k2")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps entries inside the TTL window", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(0);
      await cachePut("k3", "value", 60);
      vi.setSystemTime(30_000); // 30 s later, TTL 60s
      expect(await cacheGet("k3")).toBe("value");
    } finally {
      vi.useRealTimers();
    }
  });
});
