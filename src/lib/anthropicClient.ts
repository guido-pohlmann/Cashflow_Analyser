import Anthropic from "@anthropic-ai/sdk";

let cached: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (cached) return cached;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  cached = new Anthropic({ apiKey });
  return cached;
}

export const DEFAULT_MODEL: string =
  process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";

export const RESOLVER_MODEL: string =
  process.env.ANTHROPIC_RESOLVER_MODEL ?? "claude-haiku-4-5-20251001";
