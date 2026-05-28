import { describe, expect, it } from "vitest";

import { DEFAULT_BASE_URL, loadConfig } from "../src/config.js";

function env(values: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return values as NodeJS.ProcessEnv;
}

describe("loadConfig", () => {
  it("falls back to the default base URL when SEED4J_BASE_URL is unset", () => {
    const config = loadConfig(env({}));
    expect(config.baseUrl).toBe(DEFAULT_BASE_URL);
    expect(config.clientOptions).toEqual({});
    expect(config.warnings).toEqual([]);
  });

  it("uses SEED4J_BASE_URL when set, trimming whitespace", () => {
    const config = loadConfig(env({ SEED4J_BASE_URL: "  http://seed4j.example:8080  " }));
    expect(config.baseUrl).toBe("http://seed4j.example:8080");
  });

  it("ignores a blank SEED4J_BASE_URL", () => {
    const config = loadConfig(env({ SEED4J_BASE_URL: "   " }));
    expect(config.baseUrl).toBe(DEFAULT_BASE_URL);
  });

  it("parses SEED4J_TIMEOUT_MS as a positive integer", () => {
    const config = loadConfig(env({ SEED4J_TIMEOUT_MS: "5000" }));
    expect(config.clientOptions.timeoutMs).toBe(5000);
    expect(config.warnings).toEqual([]);
  });

  it("warns and falls back when SEED4J_TIMEOUT_MS is not numeric", () => {
    const config = loadConfig(env({ SEED4J_TIMEOUT_MS: "abc" }));
    expect(config.clientOptions.timeoutMs).toBeUndefined();
    expect(config.warnings).toHaveLength(1);
    expect(config.warnings[0]).toContain("SEED4J_TIMEOUT_MS");
    expect(config.warnings[0]).toContain("abc");
  });

  it("warns and falls back when SEED4J_TIMEOUT_MS is zero or negative", () => {
    const zero = loadConfig(env({ SEED4J_TIMEOUT_MS: "0" }));
    expect(zero.clientOptions.timeoutMs).toBeUndefined();
    expect(zero.warnings).toHaveLength(1);

    const negative = loadConfig(env({ SEED4J_TIMEOUT_MS: "-50" }));
    expect(negative.clientOptions.timeoutMs).toBeUndefined();
    expect(negative.warnings).toHaveLength(1);
  });

  it("parses SEED4J_RETRIES as a non-negative integer (0 allowed)", () => {
    const zero = loadConfig(env({ SEED4J_RETRIES: "0" }));
    expect(zero.clientOptions.retries).toBe(0);
    expect(zero.warnings).toEqual([]);

    const three = loadConfig(env({ SEED4J_RETRIES: "3" }));
    expect(three.clientOptions.retries).toBe(3);
  });

  it("warns and falls back when SEED4J_RETRIES is invalid", () => {
    const negative = loadConfig(env({ SEED4J_RETRIES: "-1" }));
    expect(negative.clientOptions.retries).toBeUndefined();
    expect(negative.warnings).toHaveLength(1);
    expect(negative.warnings[0]).toContain("SEED4J_RETRIES");

    const garbage = loadConfig(env({ SEED4J_RETRIES: "many" }));
    expect(garbage.clientOptions.retries).toBeUndefined();
    expect(garbage.warnings).toHaveLength(1);
  });

  it("passes SEED4J_AUTH_HEADER through verbatim", () => {
    const config = loadConfig(env({ SEED4J_AUTH_HEADER: "Basic dXNlcjpwYXNz" }));
    expect(config.clientOptions.authHeader).toBe("Basic dXNlcjpwYXNz");
    expect(config.warnings).toEqual([]);
  });

  it("wraps SEED4J_BEARER_TOKEN as 'Bearer <token>'", () => {
    const config = loadConfig(env({ SEED4J_BEARER_TOKEN: "abc.def.ghi" }));
    expect(config.clientOptions.authHeader).toBe("Bearer abc.def.ghi");
    expect(config.warnings).toEqual([]);
  });

  it("prefers SEED4J_AUTH_HEADER over SEED4J_BEARER_TOKEN and warns", () => {
    const config = loadConfig(
      env({ SEED4J_AUTH_HEADER: "Basic dXNlcjpwYXNz", SEED4J_BEARER_TOKEN: "abc" }),
    );
    expect(config.clientOptions.authHeader).toBe("Basic dXNlcjpwYXNz");
    expect(config.warnings).toHaveLength(1);
    expect(config.warnings[0]).toContain("SEED4J_AUTH_HEADER");
    expect(config.warnings[0]).toContain("SEED4J_BEARER_TOKEN");
  });

  it("ignores blank auth values", () => {
    const config = loadConfig(
      env({ SEED4J_AUTH_HEADER: "   ", SEED4J_BEARER_TOKEN: "   " }),
    );
    expect(config.clientOptions.authHeader).toBeUndefined();
  });

  it("combines all valid env vars into one clientOptions object", () => {
    const config = loadConfig(
      env({
        SEED4J_BASE_URL: "http://seed4j.example:8080",
        SEED4J_TIMEOUT_MS: "5000",
        SEED4J_RETRIES: "5",
        SEED4J_BEARER_TOKEN: "abc.def",
      }),
    );
    expect(config.baseUrl).toBe("http://seed4j.example:8080");
    expect(config.clientOptions).toEqual({
      timeoutMs: 5000,
      retries: 5,
      authHeader: "Bearer abc.def",
    });
    expect(config.warnings).toEqual([]);
  });
});
