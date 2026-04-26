import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/ssrfGuard", () => ({
  resolveAndCheck: vi.fn().mockResolvedValue(undefined),
}));

import { fetchPage } from "@/lib/fetchPage";
import {
  BlockedTargetError,
  FetchFailedError,
} from "@/lib/errors";

function htmlResponse(html: string, contentType = "text/html; charset=utf-8") {
  return new Response(html, {
    status: 200,
    headers: { "content-type": contentType },
  });
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchPage", () => {
  it("rejects non-http(s) protocols", async () => {
    await expect(fetchPage("ftp://example.com/")).rejects.toBeInstanceOf(
      BlockedTargetError,
    );
  });

  it("rejects unsupported content-type", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("\x89PNG", {
          status: 200,
          headers: { "content-type": "image/png" },
        }),
      ),
    );
    await expect(fetchPage("https://example.com/x")).rejects.toBeInstanceOf(
      FetchFailedError,
    );
  });

  it("rejects bodies above maxBytes cap", async () => {
    const big = new Uint8Array(3 * 1024 * 1024);
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(big);
        c.close();
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(stream, {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      ),
    );
    await expect(fetchPage("https://example.com/big")).rejects.toBeInstanceOf(
      FetchFailedError,
    );
  });

  it("follows up to MAX_REDIRECTS hops then fails", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => {
      return new Response(null, {
        status: 302,
        headers: { location: "https://example.com/again" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchPage("https://example.com/start")).rejects.toBeInstanceOf(
      FetchFailedError,
    );
    // Initial call + up to 5 redirect follows = 6 fetch invocations
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("happy path: returns FetchedPage with decoded body", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(htmlResponse("<html><body>OK</body></html>")),
    );
    const out = await fetchPage("https://example.com/page");
    expect(out.bodyHtml).toContain("OK");
    expect(out.contentType).toMatch(/text\/html/);
  });

  it("propagates BlockedTargetError from ssrfGuard", async () => {
    const mod = await import("@/lib/ssrfGuard");
    vi.mocked(mod.resolveAndCheck).mockRejectedValueOnce(
      new BlockedTargetError("private IP"),
    );
    await expect(fetchPage("https://example.com/x")).rejects.toBeInstanceOf(
      BlockedTargetError,
    );
  });
});
