import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { PACKAGE_VERSION } from "../src/version.js";

describe("PACKAGE_VERSION", () => {
  it("matches the version field in package.json", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const packageJsonPath = path.join(here, "..", "package.json");
    const raw = readFileSync(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    expect(typeof parsed.version).toBe("string");
    expect((parsed.version as string).length).toBeGreaterThan(0);
    expect(PACKAGE_VERSION).toBe(parsed.version);
  });

  it("is a non-empty semver-shaped string", () => {
    expect(PACKAGE_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("is not the previously-hardcoded placeholder", () => {
    expect(PACKAGE_VERSION).not.toBe("0.0.1");
  });
});
