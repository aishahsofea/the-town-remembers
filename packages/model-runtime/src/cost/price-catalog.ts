/**
 * `D4-M`: checked-in, immutable Bedrock/Titan pricing. Versioned so an old
 * `model_cost_reservations` row stays auditable after a real price change —
 * bump `PRICE_CATALOG_VERSION` whenever a rate below changes, never edit a
 * rate in place under the same version string.
 *
 * All arithmetic elsewhere in this package is integer micro-USD
 * (1 USD = 1,000,000 micro-USD), converted to `DECIMAL(12,6)` only at the
 * persistence boundary (`game-server`). Rates here are micro-USD per
 * *million* tokens specifically so a per-token multiply-then-divide never
 * needs a fractional micro-USD — Titan's real rate ($0.02/M tokens) would
 * otherwise round to zero on almost every call.
 *
 * Source: docs/004-infrastructure-cost-estimate.md's own aggregate
 * visit-cost derivation and its cited Anthropic Bedrock rate card and Titan
 * V2 rate ($0.02/M input tokens, doc reference [3]). These were not
 * independently re-verified against the live AWS Bedrock pricing page while
 * writing this catalog — re-verify before this ever gates real spend.
 */

export type PricingModelKey = "haiku" | "sonnet" | "titan";

export interface ModelRateMicroUsd {
  readonly inputPerMillionTokens: number;
  readonly outputPerMillionTokens: number;
  readonly cacheReadPerMillionTokens: number;
  readonly cacheWritePerMillionTokens: number;
}

export const PRICE_CATALOG_VERSION = "bedrock-prices/2026-08-01";

const HAIKU_RATES: ModelRateMicroUsd = Object.freeze({
  inputPerMillionTokens: 1_000_000,
  outputPerMillionTokens: 5_000_000,
  cacheReadPerMillionTokens: 100_000,
  cacheWritePerMillionTokens: 1_250_000,
});

const SONNET_RATES: ModelRateMicroUsd = Object.freeze({
  inputPerMillionTokens: 3_000_000,
  outputPerMillionTokens: 15_000_000,
  cacheReadPerMillionTokens: 300_000,
  cacheWritePerMillionTokens: 3_750_000,
});

const TITAN_RATES: ModelRateMicroUsd = Object.freeze({
  inputPerMillionTokens: 20_000,
  outputPerMillionTokens: 0,
  cacheReadPerMillionTokens: 0,
  cacheWritePerMillionTokens: 0,
});

const RATES_BY_MODEL: Readonly<Record<PricingModelKey, ModelRateMicroUsd>> =
  Object.freeze({
    haiku: HAIKU_RATES,
    sonnet: SONNET_RATES,
    titan: TITAN_RATES,
  });

/**
 * Worst-case token ceilings per purpose, used only for pre-call admission
 * (`worstCase` in `estimate.ts`), never for settlement. The *model* that
 * answers a purpose is a separate, runtime-resolved fact — dialogue in
 * particular runs against Sonnet by default but Haiku under reduced-cost
 * mode (`bedrock/model-resolution.ts`) — so it is not part of this catalog
 * entry; `worstCase(purpose, model)` takes the resolved model explicitly.
 *
 * Output ceilings match `model-contracts#INFERENCE_SETTINGS.maximumOutputTokens`
 * exactly — that is Bedrock's own hard cap, not an estimate. Input ceilings
 * are this session's own conservative estimate of system prompt plus a
 * maximally-sized `trusted_context` (four disclosures, three outcomes,
 * eight episodes for dialogue) and are explicitly tunable, the same
 * "tunable only after the first instrumented vertical slice" status `D4-L`
 * gives the deadline numbers.
 */
export interface PurposeTokenCeiling {
  readonly worstCaseInputTokens: number;
  readonly worstCaseOutputTokens: number;
}

export const PURPOSE_TOKEN_CEILINGS = Object.freeze({
  claim_normalization: { worstCaseInputTokens: 1500, worstCaseOutputTokens: 256 },
  dialogue_selection: { worstCaseInputTokens: 3000, worstCaseOutputTokens: 384 },
  ambient_choice: { worstCaseInputTokens: 2000, worstCaseOutputTokens: 128 },
  // The repair overlay plus the original target's own worst case input, and
  // the target's own output ceiling (a repair returns the same shape).
  structured_repair: { worstCaseInputTokens: 3000 + 1500, worstCaseOutputTokens: 384 },
  episode_embedding: { worstCaseInputTokens: 500, worstCaseOutputTokens: 0 },
  query_embedding: { worstCaseInputTokens: 200, worstCaseOutputTokens: 0 },
} as const satisfies Record<string, PurposeTokenCeiling>);

export type AgentRunPurposeKey = keyof typeof PURPOSE_TOKEN_CEILINGS;

export class UnknownPriceCatalogEntryError extends Error {
  constructor(kind: "model" | "purpose", key: string) {
    super(`Price catalog has no ${kind} entry for "${key}" — refusing to estimate.`);
    this.name = "UnknownPriceCatalogEntryError";
  }
}

const KNOWN_PRICING_MODEL_KEYS: ReadonlySet<string> = new Set(
  Object.keys(RATES_BY_MODEL),
);
const KNOWN_AGENT_RUN_PURPOSE_KEYS: ReadonlySet<string> = new Set(
  Object.keys(PURPOSE_TOKEN_CEILINGS),
);

/**
 * Fails closed: an unrecognized model has no rate to fall back to. Checks
 * membership against a plain `Set<string>` before indexing — a
 * `RATES_BY_MODEL[model as PricingModelKey]` lookup alone would type-check
 * as always-defined even for an arbitrary caller-supplied string, which is
 * exactly the case this function exists to reject.
 */
export function rateFor(model: string): ModelRateMicroUsd {
  if (!KNOWN_PRICING_MODEL_KEYS.has(model)) {
    throw new UnknownPriceCatalogEntryError("model", model);
  }
  return RATES_BY_MODEL[model as PricingModelKey];
}

/** Fails closed: an unrecognized purpose has no ceiling to fall back to. */
export function ceilingFor(purpose: string): PurposeTokenCeiling {
  if (!KNOWN_AGENT_RUN_PURPOSE_KEYS.has(purpose)) {
    throw new UnknownPriceCatalogEntryError("purpose", purpose);
  }
  return PURPOSE_TOKEN_CEILINGS[purpose as AgentRunPurposeKey];
}
