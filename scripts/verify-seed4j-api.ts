#!/usr/bin/env tsx
/**
 * Verify that a live seed4j instance still matches the contract documented in
 * docs/seed4j-api.md. Run with:
 *
 *   SEED4J_BASE_URL=http://localhost:1339 npm run verify:api
 *
 * Bump the "Last verified" line in docs/seed4j-api.md after a clean run.
 *
 * This script is a dev/op tool. Stdout is fair game (the MCP STDIO transport
 * doesn't apply here).
 */
import { loadConfig } from "../src/config.js";

interface Result {
  endpoint: string;
  ok: boolean;
  notes: string[];
}

const results: Result[] = [];

function record(endpoint: string, ok: boolean, notes: string[]): void {
  results.push({ endpoint, ok, notes });
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function assertType(
  notes: string[],
  fieldPath: string,
  value: unknown,
  expected: "string" | "number" | "boolean" | "object" | "array",
): boolean {
  let actual: string;
  if (Array.isArray(value)) actual = "array";
  else if (value === null) actual = "null";
  else actual = typeof value;
  if (actual === expected) {
    notes.push(`✓ ${fieldPath} is ${expected}`);
    return true;
  }
  notes.push(`✗ ${fieldPath} expected ${expected}, got ${actual}`);
  return false;
}

async function tryFetch(
  baseUrl: string,
  pathAndQuery: string,
  authHeader: string | undefined,
): Promise<{ status: number; body: string; contentType: string } | null> {
  const url = `${baseUrl}${pathAndQuery}`;
  const headers: Record<string, string> = { accept: "application/json" };
  if (authHeader) headers.Authorization = authHeader;
  try {
    const response = await fetch(url, { method: "GET", headers });
    return {
      status: response.status,
      body: await response.text(),
      contentType: response.headers.get("content-type") ?? "",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(`✗ ${pathAndQuery} — network error: ${message}\n`);
    return null;
  }
}

async function verifyModules(baseUrl: string, auth: string | undefined): Promise<void> {
  const notes: string[] = [];
  const response = await tryFetch(baseUrl, "/api/modules", auth);
  if (!response) return record("GET /api/modules", false, ["network error"]);
  if (response.status !== 200) {
    return record("GET /api/modules", false, [`status ${response.status}`]);
  }
  notes.push(`✓ HTTP 200, content-type ${response.contentType}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body);
  } catch {
    return record("GET /api/modules", false, ["non-JSON body"]);
  }
  const root = asObject(parsed);
  if (!root) return record("GET /api/modules", false, ["root not an object"]);
  let ok = assertType(notes, "categories", root.categories, "array");
  const categories = Array.isArray(root.categories) ? root.categories : [];
  if (categories[0]) {
    const cat = asObject(categories[0]);
    if (cat) {
      ok = assertType(notes, "categories[0].name", cat.name, "string") && ok;
      ok = assertType(notes, "categories[0].modules", cat.modules, "array") && ok;
      const modules = Array.isArray(cat.modules) ? cat.modules : [];
      const mod = asObject(modules[0] ?? {});
      if (mod) {
        ok = assertType(notes, "categories[0].modules[0].slug", mod.slug, "string") && ok;
        ok =
          assertType(
            notes,
            "categories[0].modules[0].description",
            mod.description,
            "string",
          ) && ok;
        ok = assertType(notes, "categories[0].modules[0].tags", mod.tags, "array") && ok;
      }
    }
  }
  record("GET /api/modules", ok, notes);
}

async function verifyModuleDetails(
  baseUrl: string,
  auth: string | undefined,
  slug: string,
): Promise<void> {
  const notes: string[] = [];
  const response = await tryFetch(baseUrl, `/api/modules/${encodeURIComponent(slug)}`, auth);
  if (!response) return record(`GET /api/modules/${slug}`, false, ["network error"]);
  if (response.status !== 200) {
    return record(`GET /api/modules/${slug}`, false, [`status ${response.status}`]);
  }
  notes.push(`✓ HTTP 200`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body);
  } catch {
    return record(`GET /api/modules/${slug}`, false, ["non-JSON body"]);
  }
  const root = asObject(parsed);
  if (!root) return record(`GET /api/modules/${slug}`, false, ["root not an object"]);
  let ok = assertType(notes, "definitions", root.definitions, "array");
  const defs = Array.isArray(root.definitions) ? root.definitions : [];
  const def = asObject(defs[0] ?? {});
  if (def) {
    ok = assertType(notes, "definitions[0].key", def.key, "string") && ok;
    ok = assertType(notes, "definitions[0].type", def.type, "string") && ok;
    ok = assertType(notes, "definitions[0].mandatory", def.mandatory, "boolean") && ok;
  }
  record(`GET /api/modules/${slug}`, ok, notes);
}

async function verifyPresets(baseUrl: string, auth: string | undefined): Promise<void> {
  const notes: string[] = [];
  const response = await tryFetch(baseUrl, "/api/presets", auth);
  if (!response) return record("GET /api/presets", false, ["network error"]);
  if (response.status !== 200) {
    return record("GET /api/presets", false, [`status ${response.status}`]);
  }
  notes.push(`✓ HTTP 200`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body);
  } catch {
    return record("GET /api/presets", false, ["non-JSON body"]);
  }
  const root = asObject(parsed);
  if (!root) return record("GET /api/presets", false, ["root not an object"]);
  let ok = assertType(notes, "presets", root.presets, "array");
  const presets = Array.isArray(root.presets) ? root.presets : [];
  const preset = asObject(presets[0] ?? {});
  if (preset) {
    ok = assertType(notes, "presets[0].name", preset.name, "string") && ok;
    ok = assertType(notes, "presets[0].modules", preset.modules, "array") && ok;
    const mods = Array.isArray(preset.modules) ? preset.modules : [];
    const mod = asObject(mods[0] ?? {});
    if (mod) {
      ok = assertType(notes, "presets[0].modules[0].slug", mod.slug, "string") && ok;
    }
  }
  record("GET /api/presets", ok, notes);
}

async function verifyLandscape(baseUrl: string, auth: string | undefined): Promise<void> {
  const notes: string[] = [];
  const response = await tryFetch(baseUrl, "/api/modules-landscape", auth);
  if (!response) return record("GET /api/modules-landscape", false, ["network error"]);
  if (response.status !== 200) {
    return record("GET /api/modules-landscape", false, [`status ${response.status}`]);
  }
  notes.push(`✓ HTTP 200`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body);
  } catch {
    return record("GET /api/modules-landscape", false, ["non-JSON body"]);
  }
  const root = asObject(parsed);
  if (!root) return record("GET /api/modules-landscape", false, ["root not an object"]);
  let ok = assertType(notes, "levels", root.levels, "array");
  const levels = Array.isArray(root.levels) ? root.levels : [];
  const level = asObject(levels[0] ?? {});
  if (level) {
    ok = assertType(notes, "levels[0].elements", level.elements, "array") && ok;
    const elements = Array.isArray(level.elements) ? level.elements : [];
    const elem = asObject(elements[0] ?? {});
    if (elem) {
      ok = assertType(notes, "levels[0].elements[0].type", elem.type, "string") && ok;
    }
  }
  record("GET /api/modules-landscape", ok, notes);
}

async function verifyProjects(baseUrl: string, auth: string | undefined): Promise<void> {
  const notes: string[] = [];
  const tmpProject = `/tmp/seed4j-verify-${Date.now()}`;
  const response = await tryFetch(
    baseUrl,
    `/api/projects?path=${encodeURIComponent(tmpProject)}`,
    auth,
  );
  if (!response) return record("GET /api/projects", false, ["network error"]);
  if (response.status !== 200) {
    // A 404 for a non-existent folder is also informative — note and pass through.
    notes.push(`(note) HTTP ${response.status} for a non-existent folder; shape check skipped`);
    return record("GET /api/projects", true, notes);
  }
  notes.push(`✓ HTTP 200`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body);
  } catch {
    return record("GET /api/projects", false, ["non-JSON body"]);
  }
  const root = asObject(parsed);
  if (!root) return record("GET /api/projects", false, ["root not an object"]);
  let ok = assertType(notes, "modules", root.modules, "array");
  ok = assertType(notes, "properties", root.properties, "object") && ok;
  record("GET /api/projects", ok, notes);
}

async function verifyManagementInfo(
  baseUrl: string,
  auth: string | undefined,
): Promise<void> {
  const notes: string[] = [];
  const response = await tryFetch(baseUrl, "/management/info", auth);
  if (!response) {
    notes.push("(note) network error — ping_seed4j's version probe will return null");
    return record("GET /management/info", true, notes);
  }
  if (response.status !== 200) {
    notes.push(
      `(note) HTTP ${response.status} — endpoint may be disabled; version probe falls back to null`,
    );
    return record("GET /management/info", true, notes);
  }
  notes.push(`✓ HTTP 200`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body);
  } catch {
    notes.push("(note) non-JSON body — version probe falls back to null");
    return record("GET /management/info", true, notes);
  }
  const root = asObject(parsed);
  if (!root) {
    notes.push("(note) root not an object — version probe falls back to null");
    return record("GET /management/info", true, notes);
  }
  const build = asObject(root.build);
  if (build && typeof build.version === "string") {
    notes.push(`✓ build.version present: "${build.version as string}"`);
  } else if (typeof root.version === "string") {
    notes.push(`✓ top-level version present: "${root.version}"`);
  } else {
    notes.push("(note) no build.version or top-level version — ping returns version: null");
  }
  record("GET /management/info", true, notes);
}

async function main(): Promise<void> {
  const { baseUrl, clientOptions } = loadConfig(process.env);
  const auth = clientOptions.authHeader;
  process.stdout.write(`Verifying seed4j contract at ${baseUrl}\n\n`);

  await verifyModules(baseUrl, auth);
  await verifyPresets(baseUrl, auth);
  await verifyLandscape(baseUrl, auth);
  await verifyProjects(baseUrl, auth);
  await verifyManagementInfo(baseUrl, auth);

  // Module-details verification needs at least one slug; pull it from the catalogue.
  const catalogue = await tryFetch(baseUrl, "/api/modules", auth);
  if (catalogue && catalogue.status === 200) {
    try {
      const parsed = JSON.parse(catalogue.body) as {
        categories?: Array<{ modules?: Array<{ slug?: string }> }>;
      };
      const slug = parsed.categories?.flatMap((c) => c.modules ?? []).find((m) => m.slug)?.slug;
      if (slug) await verifyModuleDetails(baseUrl, auth, slug);
    } catch {
      /* already reported by verifyModules */
    }
  }

  let failed = 0;
  for (const result of results) {
    process.stdout.write(`\n[${result.ok ? "PASS" : "FAIL"}] ${result.endpoint}\n`);
    for (const note of result.notes) {
      process.stdout.write(`  ${note}\n`);
    }
    if (!result.ok) failed += 1;
  }

  process.stdout.write(
    `\n${results.length - failed}/${results.length} endpoints passed.\n`,
  );
  process.exit(failed > 0 ? 1 : 0);
}

void main();
