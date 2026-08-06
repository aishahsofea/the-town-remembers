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

function synthesizedTemplate(): Template {
  return Template.fromStack(createApp(DEPLOYMENT).stack);
}

function templateJson(): Record<string, unknown> {
  return synthesizedTemplate().toJSON();
}

describe("foundation stack", () => {
  it("creates exactly the three Lambda artifacts", () => {
    const template = synthesizedTemplate();
    template.resourceCountIs("AWS::Lambda::Function", 3);

    for (const [timeout, memory] of [
      [28, 512],
      [30, 512],
      [30, 256],
    ] as const) {
      template.hasResourceProperties("AWS::Lambda::Function", {
        Timeout: timeout,
        MemorySize: memory,
        Runtime: "nodejs22.x",
        Architectures: ["arm64"],
      });
    }
  });

  it("passes only non-secret identity into the function environment", () => {
    synthesizedTemplate().hasResourceProperties("AWS::Lambda::Function", {
      Environment: { Variables: { TTR_ENV: "production", TTR_BUILD_ID: "a1b2c3d" } },
    });
  });

  it("creates none of the resources Phase 7 owns", () => {
    const template = synthesizedTemplate();
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
      template.resourceCountIs(type, 0);
    }
    expect(DEFERRED_TO_PHASE_7.length).toBeGreaterThan(0);
  });

  it("grants no wildcard action or resource", () => {
    const policies = synthesizedTemplate().findResources("AWS::IAM::Policy");
    const roles = synthesizedTemplate().findResources("AWS::IAM::Role");

    for (const resource of [...Object.values(policies), ...Object.values(roles)]) {
      const serialized = JSON.stringify(resource);
      expect(serialized).not.toContain('"Action":"*"');
      expect(serialized).not.toContain('"Resource":"*"');
      expect(serialized).not.toContain('"Action":["*"]');
      expect(serialized).not.toContain('"Resource":["*"]');
    }
  });

  it("contains no plaintext secret value", () => {
    const serialized = JSON.stringify(templateJson());
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
    expect(JSON.stringify(templateJson())).toBe(JSON.stringify(templateJson()));
  });

  it("names the stack from the deployment environment", () => {
    expect(stackName(DEPLOYMENT)).toBe("TheTownRemembersFoundationProduction");
    expect(stackName({ ...DEPLOYMENT, environment: "development" })).toBe(
      "TheTownRemembersFoundationDevelopment",
    );
  });

  it("binds the account and region from deployment configuration", () => {
    const { stack } = createApp(DEPLOYMENT);
    expect(stack.account).toBe("123456789012");
    expect(stack.region).toBe("eu-west-1");
  });
});
