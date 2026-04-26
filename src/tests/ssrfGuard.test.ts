import { describe, it, expect } from "vitest";
import { BlockedTargetError } from "@/lib/errors";
import { resolveAndCheck } from "@/lib/ssrfGuard";

describe("ssrfGuard.resolveAndCheck", () => {
  it("blocks IPv4 loopback 127.0.0.1", async () => {
    await expect(resolveAndCheck("http://127.0.0.1/")).rejects.toBeInstanceOf(
      BlockedTargetError,
    );
  });

  it("blocks RFC1918 10.0.0.5", async () => {
    await expect(resolveAndCheck("http://10.0.0.5/")).rejects.toBeInstanceOf(
      BlockedTargetError,
    );
  });

  it("blocks RFC1918 192.168.1.1", async () => {
    await expect(resolveAndCheck("http://192.168.1.1/")).rejects.toBeInstanceOf(
      BlockedTargetError,
    );
  });

  it("blocks RFC1918 172.16.0.1", async () => {
    await expect(resolveAndCheck("http://172.16.0.1/")).rejects.toBeInstanceOf(
      BlockedTargetError,
    );
  });

  it("blocks link-local 169.254.169.254 (cloud metadata)", async () => {
    await expect(
      resolveAndCheck("http://169.254.169.254/"),
    ).rejects.toBeInstanceOf(BlockedTargetError);
  });

  it("blocks IPv6 loopback ::1", async () => {
    await expect(resolveAndCheck("http://[::1]/")).rejects.toBeInstanceOf(
      BlockedTargetError,
    );
  });

  it("blocks IPv6 unique-local fc00::1", async () => {
    await expect(resolveAndCheck("http://[fc00::1]/")).rejects.toBeInstanceOf(
      BlockedTargetError,
    );
  });

  it("blocks IPv4-mapped IPv6 ::ffff:127.0.0.1", async () => {
    await expect(
      resolveAndCheck("http://[::ffff:127.0.0.1]/"),
    ).rejects.toBeInstanceOf(BlockedTargetError);
  });

  it("blocks hostname 'localhost'", async () => {
    await expect(resolveAndCheck("http://localhost/")).rejects.toBeInstanceOf(
      BlockedTargetError,
    );
  });

  it("blocks hostname 'metadata.google.internal'", async () => {
    await expect(
      resolveAndCheck("http://metadata.google.internal/"),
    ).rejects.toBeInstanceOf(BlockedTargetError);
  });

  it("allows public IPv4 1.1.1.1", async () => {
    await expect(resolveAndCheck("http://1.1.1.1/")).resolves.toBeUndefined();
  });

  it("allows public IPv4 8.8.8.8", async () => {
    await expect(resolveAndCheck("http://8.8.8.8/")).resolves.toBeUndefined();
  });
});
