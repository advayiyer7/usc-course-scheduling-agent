import { describe, expect, it } from "vitest";
import { mailConfig, mailReadiness } from "../apps/api/src/mail-config.js";

const configured = {
  ALERTS_INBOUND_DOMAIN: "fictional.resend.app",
  RESEND_API_KEY: "re_FICTIONAL_KEY_FOR_TESTING",
  RESEND_WEBHOOK_SECRET: "whsec_RklDVElPTkFMX1RFTV9TRUNSRVQ=",
};
describe("live mail setup", () => {
  it("leaves receiving disabled until configured", () => {
    expect(mailConfig({})).toBeUndefined();
    expect(mailReadiness({}).ready).toBe(false);
  });
  it("supports the managed receiving subdomain without requiring DNS or exposing keys", () => {
    expect(mailConfig(configured)?.port).toBe(3001);
    const readiness = mailReadiness(configured);
    expect(readiness.ready).toBe(true);
    expect(JSON.stringify(readiness)).not.toContain(configured.RESEND_API_KEY);
    expect(JSON.stringify(readiness)).not.toContain(
      configured.RESEND_WEBHOOK_SECRET,
    );
  });
  it.each(Object.keys(configured))(
    "rejects missing %s before advertising an unusable address",
    (key) => {
      const env: NodeJS.ProcessEnv = { ...configured };
      delete env[key];
      expect(mailReadiness(env).ready).toBe(false);
    },
  );
  it.each([
    "https://example.com",
    "person@example.com",
    "-bad.example.com",
    "example.com/path",
    "UPPER.example.com",
  ])("rejects malformed receiving domain %s", (domain) => {
    expect(
      mailReadiness({ ...configured, ALERTS_INBOUND_DOMAIN: domain }).ready,
    ).toBe(false);
  });
  it.each(["3000", "80", "65536", "NaN"])(
    "rejects unsafe or conflicting port %s",
    (port) => {
      expect(
        mailReadiness({ ...configured, ALERTS_MAIL_PORT: port }).ready,
      ).toBe(false);
    },
  );
  it("does not log malformed credentials through validation errors", () => {
    const key = "private-key-with-a-newline\n";
    expect(
      JSON.stringify(mailReadiness({ ...configured, RESEND_API_KEY: key })),
    ).not.toContain(key);
  });
});
