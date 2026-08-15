import { Template } from "aws-cdk-lib/assertions";
import { loadDeploymentConfig } from "@the-town-remembers/runtime-config/deployment";
import { describe, expect, it } from "vitest";

import { createApp, stackName } from "./app.js";
import { DEFERRED_TO_PHASE_7 } from "./foundation-stack.js";

const DEPLOYMENT = loadDeploymentConfig({
  TTR_ENV: "production",
  TTR_BUILD_ID: "a1b2c3d",
  TTR_AWS_REGION: "eu-west-1",
  TTR_AWS_ACCOUNT: "123456789012",
});

/**
 * One app/template fixture, synthesized once and reused read-only by every
 * assertion below (`VPR-12`) — CDK synthesis is the expensive part of this
 * file (roughly eight independent syntheses before this change), and none
 * of `Template`'s query methods (`resourceCountIs`, `hasResourceProperties`,
 * `findResources`, `toJSON`) mutate the stack they read from.
 *
 * "synthesizes identically twice" is the one deliberate exception: it
 * performs exactly one additional independent synthesis and compares it
 * against this fixture, rather than reusing it as a no-op comparison
 * against itself.
 */
const FOUNDATION_APP = createApp(DEPLOYMENT);
const TEMPLATE = Template.fromStack(FOUNDATION_APP.stack);
const TEMPLATE_JSON = TEMPLATE.toJSON();

describe("foundation stack", () => {
  it("creates exactly the three Lambda artifacts", () => {
    TEMPLATE.resourceCountIs("AWS::Lambda::Function", 3);

    for (const [timeout, memory] of [
      [28, 512],
      [30, 512],
      [30, 256],
    ] as const) {
      TEMPLATE.hasResourceProperties("AWS::Lambda::Function", {
        Timeout: timeout,
        MemorySize: memory,
        Runtime: "nodejs22.x",
        Architectures: ["arm64"],
      });
    }
  });

  it("passes only non-secret identity into the function environment", () => {
    TEMPLATE.hasResourceProperties("AWS::Lambda::Function", {
      Environment: { Variables: { TTR_ENV: "production", TTR_BUILD_ID: "a1b2c3d" } },
    });
  });

  it("creates none of the resources Phase 7 owns", () => {
    for (const type of [
      "AWS::S3::Bucket",
      "AWS::CloudFront::Distribution",
      "AWS::ApiGatewayV2::Api",
      "AWS::SQS::Queue",
      "AWS::Events::Rule",
      "AWS::SecretsManager::Secret",
      "AWS::CloudWatch::Alarm",
      "AWS::Budgets::Budget",
    ]) {
      TEMPLATE.resourceCountIs(type, 0);
    }
    expect(DEFERRED_TO_PHASE_7.length).toBeGreaterThan(0);
  });

  it("grants no wildcard action or resource", () => {
    const policies = TEMPLATE.findResources("AWS::IAM::Policy");
    const roles = TEMPLATE.findResources("AWS::IAM::Role");

    for (const resource of [...Object.values(policies), ...Object.values(roles)]) {
      const serialized = JSON.stringify(resource);
      expect(serialized).not.toContain('"Action":"*"');
      expect(serialized).not.toContain('"Resource":"*"');
      expect(serialized).not.toContain('"Action":["*"]');
      expect(serialized).not.toContain('"Resource":["*"]');
    }
  });

  it("contains no plaintext secret value", () => {
    const serialized = JSON.stringify(TEMPLATE_JSON);
    for (const marker of [
      "postgresql://",
      "AKIA",
      "-----BEGIN",
      "SECRET",
      "PASSWORD",
      "JUDGE",
      "hunter2",
    ]) {
      expect(serialized).not.toContain(marker);
    }
  });

  it("synthesizes identically twice", () => {
    const independentTemplateJson = Template.fromStack(
      createApp(DEPLOYMENT).stack,
    ).toJSON();
    expect(JSON.stringify(independentTemplateJson)).toBe(JSON.stringify(TEMPLATE_JSON));
  });

  it("names the stack from the deployment environment", () => {
    expect(stackName(DEPLOYMENT)).toBe("TheTownRemembersFoundationProduction");
    expect(stackName({ ...DEPLOYMENT, environment: "development" })).toBe(
      "TheTownRemembersFoundationDevelopment",
    );
  });

  it("binds the account and region from deployment configuration", () => {
    expect(FOUNDATION_APP.stack.account).toBe("123456789012");
    expect(FOUNDATION_APP.stack.region).toBe("eu-west-1");
  });
});
