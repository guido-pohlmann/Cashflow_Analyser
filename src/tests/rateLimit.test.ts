import { describe, it, expect, beforeEach, vi } from "vitest";

describe("rateLimit (graceful no-op without Upstash)", () => {
  beforeEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    vi.resetModules();
  });

  it("never blocks when Upstash env vars are absent", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { checkRateLimit } = await import("@/lib/rateLimit");
    const out = await checkRateLimit("1.2.3.4");
    expect(out.blocked).toBe(false);
    expect(out.remaining).toBe(Infinity);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Rate-Limit deaktiviert"),
    );
    warn.mockRestore();
  });

  it("memoises the no-op decision (warns only once across calls)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { checkRateLimit } = await import("@/lib/rateLimit");
    await checkRateLimit("1.2.3.4");
    await checkRateLimit("1.2.3.4");
    await checkRateLimit("5.6.7.8");
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe("rateLimit (Upstash configured)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("@upstash/redis", () => ({
      Redis: class {},
    }));
    process.env.UPSTASH_REDIS_REST_URL = "https://fake.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "fake-token";
  });

  it("returns blocked=false + remaining when Upstash allows", async () => {
    vi.doMock("@upstash/ratelimit", () => ({
      Ratelimit: class {
        static slidingWindow() {
          return {};
        }
        async limit() {
          return { success: true, remaining: 7 };
        }
      },
    }));
    const { checkRateLimit } = await import("@/lib/rateLimit");
    const out = await checkRateLimit("1.2.3.4");
    expect(out).toEqual({ blocked: false, remaining: 7 });
  });

  it("returns blocked=true when Upstash denies", async () => {
    vi.doMock("@upstash/ratelimit", () => ({
      Ratelimit: class {
        static slidingWindow() {
          return {};
        }
        async limit() {
          return { success: false, remaining: 0 };
        }
      },
    }));
    const { checkRateLimit } = await import("@/lib/rateLimit");
    const out = await checkRateLimit("1.2.3.4");
    expect(out).toEqual({ blocked: true, remaining: 0 });
  });
});
