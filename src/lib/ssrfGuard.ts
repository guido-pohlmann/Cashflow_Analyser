import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { BlockedTargetError } from "./errors";

const HOSTNAME_BLOCK = new Set<string>([
  "localhost",
  "metadata.google.internal",
  "metadata",
]);

const IPV4_BLOCKS: ReadonlyArray<string> = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "224.0.0.0/4",
  "240.0.0.0/4",
];

const IPV6_BLOCKS: ReadonlyArray<string> = ["::1/128", "fc00::/7", "fe80::/10"];

function ipv4ToInt(ip: string): number {
  const parts = ip.split(".");
  if (parts.length !== 4) throw new Error(`Invalid IPv4: ${ip}`);
  return (
    (parseInt(parts[0]!, 10) << 24) +
    (parseInt(parts[1]!, 10) << 16) +
    (parseInt(parts[2]!, 10) << 8) +
    parseInt(parts[3]!, 10)
  ) >>> 0;
}

function ipv4InCidr(ip: string, cidr: string): boolean {
  const [block, bitsStr] = cidr.split("/");
  const bits = Number(bitsStr);
  const blockInt = ipv4ToInt(block!);
  const ipInt = ipv4ToInt(ip);
  if (bits === 0) return true;
  const mask = (~0 << (32 - bits)) >>> 0;
  return (blockInt & mask) === (ipInt & mask);
}

function ipv6ToBigInt(ip: string): bigint {
  let normalized = ip;
  // IPv4-mapped (::ffff:1.2.3.4) → expand the v4 part to two hex groups.
  if (normalized.includes(".")) {
    const lastColon = normalized.lastIndexOf(":");
    const head = normalized.slice(0, lastColon);
    const v4 = normalized.slice(lastColon + 1);
    const v4parts = v4.split(".").map((p) => parseInt(p, 10));
    if (v4parts.length !== 4 || v4parts.some((n) => Number.isNaN(n))) {
      throw new Error(`Invalid embedded IPv4 in ${ip}`);
    }
    const hex1 = (((v4parts[0]! << 8) | v4parts[1]!) >>> 0).toString(16);
    const hex2 = (((v4parts[2]! << 8) | v4parts[3]!) >>> 0).toString(16);
    normalized = `${head}:${hex1}:${hex2}`;
  }
  const parts = normalized.split("::");
  const head = parts[0] ? parts[0].split(":") : [];
  const tail = parts.length > 1 && parts[1] ? parts[1].split(":") : [];
  const fillCount = 8 - head.length - tail.length;
  if (fillCount < 0) throw new Error(`Invalid IPv6: ${ip}`);
  const all = [...head, ...Array(fillCount).fill("0"), ...tail];
  if (all.length !== 8) throw new Error(`Invalid IPv6: ${ip}`);
  let result = 0n;
  for (const group of all) {
    result = (result << 16n) + BigInt(parseInt(group || "0", 16));
  }
  return result;
}

function ipv6InCidr(ip: string, cidr: string): boolean {
  const [block, bitsStr] = cidr.split("/");
  const bits = Number(bitsStr);
  const ipBig = ipv6ToBigInt(ip);
  const blockBig = ipv6ToBigInt(block!);
  if (bits === 0) return true;
  const shift = 128n - BigInt(bits);
  const mask = ((1n << 128n) - 1n) ^ ((1n << shift) - 1n);
  return (ipBig & mask) === (blockBig & mask);
}

function isBlockedAddress(addr: string, family: number): boolean {
  if (family === 4) {
    return IPV4_BLOCKS.some((c) => ipv4InCidr(addr, c));
  }
  if (family === 6) {
    // IPv4-mapped IPv6: also check IPv4 blocklist on the embedded address.
    const lower = addr.toLowerCase();
    if (lower.startsWith("::ffff:")) {
      const tail = addr.slice(7);
      if (isIP(tail) === 4 && IPV4_BLOCKS.some((c) => ipv4InCidr(tail, c))) {
        return true;
      }
    }
    return IPV6_BLOCKS.some((c) => ipv6InCidr(addr, c));
  }
  return false;
}

export async function resolveAndCheck(rawUrl: string): Promise<void> {
  const u = new URL(rawUrl);
  const hostname = u.hostname.toLowerCase();

  if (hostname === "" || HOSTNAME_BLOCK.has(hostname)) {
    throw new BlockedTargetError(
      `Hostname "${hostname}" ist nicht erlaubt.`,
    );
  }

  // Hostname is already an IP literal — no DNS needed.
  const family = isIP(hostname);
  if (family) {
    if (isBlockedAddress(hostname, family)) {
      throw new BlockedTargetError(
        `IP ${hostname} liegt in einem privaten/Loopback-Bereich.`,
      );
    }
    return;
  }

  // DNS resolve and check every returned address.
  let records: { address: string; family: number }[];
  try {
    records = await lookup(hostname, { all: true, verbatim: true });
  } catch (e) {
    throw new BlockedTargetError(
      `DNS-Auflösung von ${hostname} fehlgeschlagen: ${e instanceof Error ? e.message : "unbekannt"}.`,
    );
  }
  for (const rec of records) {
    if (isBlockedAddress(rec.address, rec.family)) {
      throw new BlockedTargetError(
        `Auflösung von ${hostname} → ${rec.address} ist blockiert.`,
      );
    }
  }
}
