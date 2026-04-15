import { describe, expect, it } from "vitest";

import { buildContentSecurityPolicy, isAllowedExternalUrl, isTrustedRendererUrl } from "../../electron/main/security/securityConfig";

describe("security config", () => {
  it("allows only safe external http protocols", () => {
    expect(isAllowedExternalUrl("https://openai.com")).toBe(true);
    expect(isAllowedExternalUrl("http://localhost:5173")).toBe(true);
    expect(isAllowedExternalUrl("file:///etc/passwd")).toBe(false);
    expect(isAllowedExternalUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedExternalUrl("data:text/html,hello")).toBe(false);
  });

  it("recognizes only trusted renderer origins", () => {
    expect(isTrustedRendererUrl("file:///Applications/bukowskiOS/index.html")).toBe(true);
    expect(isTrustedRendererUrl("http://localhost:5173")).toBe(true);
    expect(isTrustedRendererUrl("https://127.0.0.1:4173")).toBe(true);
    expect(isTrustedRendererUrl("https://evil.example")).toBe(false);
  });

  it("builds a CSP that keeps OpenAI and the local dev server reachable", () => {
    const policy = buildContentSecurityPolicy("http://localhost:5173", ["https://jmxkejpdklrrzhvzjlqm.supabase.co"]);

    expect(policy).toContain("https://api.openai.com");
    expect(policy).toContain("https://jmxkejpdklrrzhvzjlqm.supabase.co");
    expect(policy).toContain("http://localhost:5173");
    expect(policy).toContain("ws://localhost:5173");
    expect(policy).toContain("'unsafe-inline'");
    expect(policy).toContain("'unsafe-eval'");
    expect(policy).toContain("object-src 'none'");
  });

  it("keeps the packaged CSP stricter than dev", () => {
    const policy = buildContentSecurityPolicy();

    expect(policy).not.toContain("'unsafe-inline' 'unsafe-eval'");
    expect(policy).not.toContain("http://localhost:5173");
    expect(policy).not.toContain("http://insecure.supabase.co");
    expect(policy).toContain("frame-ancestors 'none'");
  });
});
