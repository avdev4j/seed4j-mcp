import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FALLBACK_VERSION = "0.0.0";

function readPackageVersion(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const packageJsonPath = path.join(here, "..", "package.json");
    const raw = readFileSync(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    if (typeof parsed.version === "string" && parsed.version.length > 0) {
      return parsed.version;
    }
    return FALLBACK_VERSION;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `seed4j-mcp: could not read package version (${message}); using ${FALLBACK_VERSION}\n`,
    );
    return FALLBACK_VERSION;
  }
}

export const PACKAGE_VERSION = readPackageVersion();
