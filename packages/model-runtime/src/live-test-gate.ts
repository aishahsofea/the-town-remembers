/**
 * Gate for the opt-in `model-live` vitest project (`D4-U`).
 *
 * Two independent conditions, both printed explicitly rather than left to a
 * bare "skipped" line: the opt-in flag itself, and a best-effort check for
 * *some* AWS credential source being configured. The credential check
 * cannot be exhaustive — it does not attempt to resolve the SDK's full
 * provider chain (a shared config file, SSO, an instance/container role) —
 * it only looks for the handful of environment variables a developer or CI
 * job would set directly. A false negative here (real credentials present
 * some other way) just means the test skips when it could have run; a false
 * positive is not possible, since a genuinely uncredentialed Bedrock call
 * still fails on its own and that failure is a real signal, not this gate's
 * job to mask.
 */

import process from "node:process";

const CREDENTIAL_ENV_VARS = [
  "AWS_ACCESS_KEY_ID",
  "AWS_PROFILE",
  "AWS_ROLE_ARN",
  "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
  "AWS_CONTAINER_CREDENTIALS_FULL_URI",
] as const;

export interface LiveModelTestGate {
  readonly shouldRun: boolean;
  /** Empty when `shouldRun` is true. */
  readonly skipReason: string;
}

export function evaluateLiveModelTestGate(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): LiveModelTestGate {
  if (environment["TTR_MODEL_LIVE_TESTS"] !== "1") {
    return {
      shouldRun: false,
      skipReason:
        'TTR_MODEL_LIVE_TESTS is not "1" — run `pnpm test:model:live` to opt in.',
    };
  }

  const hasCredentialHint = CREDENTIAL_ENV_VARS.some(
    (name) => environment[name] !== undefined && environment[name] !== "",
  );
  if (!hasCredentialHint) {
    return {
      shouldRun: false,
      skipReason:
        `TTR_MODEL_LIVE_TESTS=1 but no AWS credential environment variable is set ` +
        `(checked: ${CREDENTIAL_ENV_VARS.join(", ")}). If credentials come from a ` +
        `shared config file or an instance role, this best-effort check cannot see ` +
        `them — set one of these variables, or run against real Bedrock manually.`,
    };
  }

  return { shouldRun: true, skipReason: "" };
}
