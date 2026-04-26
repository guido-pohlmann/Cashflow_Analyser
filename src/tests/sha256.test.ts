import { describe, it, expect } from "vitest";
import { sha256 } from "@/lib/sha256";

describe("sha256", () => {
  it("returns a 64-char lowercase hex digest", () => {
    const out = sha256("hello");
    expect(out).toMatch(/^[0-9a-f]{64}$/);
  });

  it("matches the known vector for an empty string", () => {
    expect(sha256("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("matches the known vector for 'abc'", () => {
    expect(sha256("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("is deterministic", () => {
    const url = "https://investor.example.com/q4";
    expect(sha256(url)).toBe(sha256(url));
  });

  it("produces different hashes for different inputs", () => {
    expect(sha256("a")).not.toBe(sha256("b"));
  });
});
