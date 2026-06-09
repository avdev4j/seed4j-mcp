import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { PACKAGE_VERSION } from "../src/version.js";

describe("PACKAGE_VERSION", () => {
  function readJson(fileName: string): Record<string, unknown> {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const filePath = path.join(here, "..", fileName);
    const raw = readFileSync(filePath, "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  }

  it("matches the version field in package.json", () => {
    const parsed = readJson("package.json") as { version?: unknown };
    expect(typeof parsed.version).toBe("string");
    expect((parsed.version as string).length).toBeGreaterThan(0);
    expect(PACKAGE_VERSION).toBe(parsed.version);
  });

  it("keeps package-lock.json aligned with package.json", () => {
    const packageJson = readJson("package.json") as { version?: unknown };
    const packageLock = readJson("package-lock.json") as {
      version?: unknown;
      packages?: Record<string, { version?: unknown }>;
    };
    expect(packageLock.version).toBe(packageJson.version);
    expect(packageLock.packages?.[""]?.version).toBe(packageJson.version);
  });

  it("is a non-empty semver-shaped string", () => {
    expect(PACKAGE_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("is not the previously-hardcoded placeholder", () => {
    expect(PACKAGE_VERSION).not.toBe("0.0.1");
  });
});
