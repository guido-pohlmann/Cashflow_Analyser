import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

let limiter: Ratelimit | null = null;
let probed = false;

function getLimiter(): Ratelimit | null {
  if (probed) return limiter;
  probed = true;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    console.warn(
      "[rateLimit] UPSTASH_REDIS_REST_URL/TOKEN fehlt — Rate-Limit deaktiviert.",
    );
    return null;
  }
  limiter = new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.slidingWindow(10, "1 h"),
    analytics: false,
    prefix: "cf:rl",
  });
  return limiter;
}

export interface RateLimitResult {
  blocked: boolean;
  remaining: number;
}

export async function checkRateLimit(ip: string): Promise<RateLimitResult> {
  const rl = getLimiter();
  if (!rl) return { blocked: false, remaining: Infinity };
  const { success, remaining } = await rl.limit(ip);
  return { blocked: !success, remaining };
}
