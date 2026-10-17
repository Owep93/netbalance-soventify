import OpenAI from "openai";
import type { Complete } from "@/agent/run";

// Nicrron is OpenAI-compatible. Pinned to providers that do not train on API data
// (see nicrron.ai/docs/models, privacy section), with a fallback if the first is down.
const DEFAULT_MODEL = "anthropic/claude-sonnet-5-5";
const FALLBACKS = ["anthropic/claude-sonnet-5-5", "openai/gpt-6-sol"];

export function nicrronModel(): string {
  return process.env.NICRRON_MODEL || DEFAULT_MODEL;
}

export function nicrronComplete(): Complete {
  const apiKey = process.env.NICRRON_API_KEY;
  if (!apiKey) throw new Error("NICRRON_API_KEY is not set in .env.local");
  const client = new OpenAI({
    baseURL: process.env.NICRRON_BASE_URL || "https://api.nicrron.ai/v1",
    apiKey,
  });
  // `models` is Nicrron's fallback list; the OpenAI types do not know about it.
  return (params) => client.chat.completions.create({ ...params, models: FALLBACKS } as typeof params);
}
