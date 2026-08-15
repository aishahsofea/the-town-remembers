/**
 * Model-runtime configuration for Bedrock (Haiku/Sonnet) and Titan.
 *
 * Phase 4 is the repository's first external network dependency. This
 * category carries only identity and tuning: resolved model ids, an optional
 * inference-profile ARN per chat role, the price-catalog version, and two
 * opt-in flags. It carries **no** AWS access key — credentials come from the
 * default provider chain (an IAM role in every deployed environment). Like
 * `./security` (`D3-C`), `check-workspace-boundaries.mjs` restricts this
 * subpath to the packages that actually call a model, so the browser bundle
 * has no import path to it even by accident.
 */

import { z } from "zod";

import {
  parseEnvironment,
  required,
  withDefault,
  type EnvironmentRecord,
} from "./shared.js";

export {
  ConfigurationError,
  type ConfigurationCategory,
  type ConfigurationIssue,
} from "./shared.js";
export { MODEL_DEADLINES, MODEL_RETRIES } from "./reliability.js";

const FLAG_VALUES = ["0", "1"] as const;

const ModelConfigSchema = z.strictObject({
  TTR_AWS_REGION: z.string().min(1),
  TTR_BEDROCK_HAIKU_MODEL_ID: z.string().min(1),
  TTR_BEDROCK_SONNET_MODEL_ID: z.string().min(1),
  TTR_BEDROCK_TITAN_MODEL_ID: z.string().min(1),
  TTR_BEDROCK_HAIKU_INFERENCE_PROFILE_ARN: z.string().min(1).optional(),
  TTR_BEDROCK_SONNET_INFERENCE_PROFILE_ARN: z.string().min(1).optional(),
  TTR_MODEL_PRICE_CATALOG_VERSION: z.string().min(1),
  TTR_MODEL_REDUCED_COST_OVERRIDE: z.enum(FLAG_VALUES),
  TTR_MODEL_LIVE_TESTS: z.enum(FLAG_VALUES),
});

export interface ModelConfig {
  readonly region: string;
  readonly haikuModelId: string;
  readonly sonnetModelId: string;
  readonly titanModelId: string;
  /** Resolved ARN when configured; a bare model id otherwise (`D4-N`). */
  readonly haikuInferenceProfileArn: string | undefined;
  readonly sonnetInferenceProfileArn: string | undefined;
  readonly priceCatalogVersion: string;
  /** Forces reduced-cost (Haiku dialogue) mode regardless of monthly spend. */
  readonly reducedCostOverride: boolean;
  /** Opt-in for the `model-live` vitest project and live smoke commands. */
  readonly liveTestsEnabled: boolean;
}

export function loadModelConfig(source: EnvironmentRecord): ModelConfig {
  const parsed = parseEnvironment(
    "model-runtime",
    ModelConfigSchema,
    {
      TTR_AWS_REGION: required(source, "TTR_AWS_REGION"),
      TTR_BEDROCK_HAIKU_MODEL_ID: required(source, "TTR_BEDROCK_HAIKU_MODEL_ID"),
      TTR_BEDROCK_SONNET_MODEL_ID: required(source, "TTR_BEDROCK_SONNET_MODEL_ID"),
      TTR_BEDROCK_TITAN_MODEL_ID: required(source, "TTR_BEDROCK_TITAN_MODEL_ID"),
      TTR_BEDROCK_HAIKU_INFERENCE_PROFILE_ARN: required(
        source,
        "TTR_BEDROCK_HAIKU_INFERENCE_PROFILE_ARN",
      ),
      TTR_BEDROCK_SONNET_INFERENCE_PROFILE_ARN: required(
        source,
        "TTR_BEDROCK_SONNET_INFERENCE_PROFILE_ARN",
      ),
      TTR_MODEL_PRICE_CATALOG_VERSION: required(
        source,
        "TTR_MODEL_PRICE_CATALOG_VERSION",
      ),
      TTR_MODEL_REDUCED_COST_OVERRIDE: withDefault(
        source,
        "TTR_MODEL_REDUCED_COST_OVERRIDE",
        "0",
      ),
      TTR_MODEL_LIVE_TESTS: withDefault(source, "TTR_MODEL_LIVE_TESTS", "0"),
    },
    source,
  );

  return {
    region: parsed.TTR_AWS_REGION,
    haikuModelId: parsed.TTR_BEDROCK_HAIKU_MODEL_ID,
    sonnetModelId: parsed.TTR_BEDROCK_SONNET_MODEL_ID,
    titanModelId: parsed.TTR_BEDROCK_TITAN_MODEL_ID,
    haikuInferenceProfileArn: parsed.TTR_BEDROCK_HAIKU_INFERENCE_PROFILE_ARN,
    sonnetInferenceProfileArn: parsed.TTR_BEDROCK_SONNET_INFERENCE_PROFILE_ARN,
    priceCatalogVersion: parsed.TTR_MODEL_PRICE_CATALOG_VERSION,
    reducedCostOverride: parsed.TTR_MODEL_REDUCED_COST_OVERRIDE === "1",
    liveTestsEnabled: parsed.TTR_MODEL_LIVE_TESTS === "1",
  };
}
