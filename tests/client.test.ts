import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HttpError, Seed4jClient, TimeoutError, type FetchLike } from "../src/client.js";
import type { LogLevel, Logger } from "../src/logger.js";

const BASE_URL = "http://test";

interface CapturedCall {
  url: string;
  method: string;
  body?: string;
  headers?: Record<string, string>;
}

type ResponseFactory = (call: CapturedCall) => Response;

function mockFetcher() {
  const calls: CapturedCall[] = [];
  const queue: ResponseFactory[] = [];

  const fetcher = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = input.toString();
    const body = typeof init?.body === "string" ? init.body : undefined;
    const headers = init?.headers as Record<string, string> | undefined;
    const call: CapturedCall = { url, method: init?.method ?? "GET", body, headers };
    calls.push(call);
    const factory = queue.shift();
    if (!factory) {
      throw new Error(`No mock response queued for ${url}`);
    }
    return factory(call);
  });

  const enqueue = (factory: ResponseFactory) => {
    queue.push(factory);
  };

  const jsonOk = (body: string) =>
    enqueue(
      () =>
        new Response(body, {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );

  const badRequest = (body: string) => enqueue(() => new Response(body, { status: 400 }));

  const assertDrained = () => {
    expect(queue.length, "queued responses left unconsumed").toBe(0);
  };

  return { fetcher: fetcher as unknown as FetchLike, calls, jsonOk, badRequest, assertDrained };
}

describe("Seed4jClient", () => {
  let mocks: ReturnType<typeof mockFetcher>;
  let client: Seed4jClient;

  beforeEach(() => {
    mocks = mockFetcher();
    client = new Seed4jClient(BASE_URL, mocks.fetcher);
  });

  afterEach(() => {
    mocks.assertDrained();
  });

  describe("listModules", () => {
    it("returns the raw response body", async () => {
      mocks.jsonOk('{"categories":[]}');
      await expect(client.listModules()).resolves.toBe('{"categories":[]}');
      expect(mocks.calls[0]?.url).toBe(`${BASE_URL}/api/modules`);
      expect(mocks.calls[0]?.method).toBe("GET");
    });

    it("wraps non-2xx responses in HttpError", async () => {
      mocks.badRequest("boom");
      await expect(client.listModules()).rejects.toBeInstanceOf(HttpError);
    });
  });

  describe("getModuleDetails", () => {
    it("includes the slug in the URL path", async () => {
      mocks.jsonOk('{"definitions":[]}');
      await expect(client.getModuleDetails("maven-java")).resolves.toBe('{"definitions":[]}');
      expect(mocks.calls[0]?.url).toBe(`${BASE_URL}/api/modules/maven-java`);
    });
  });

  describe("listPresets", () => {
    it("returns the raw response body", async () => {
      mocks.jsonOk('{"presets":[]}');
      await expect(client.listPresets()).resolves.toBe('{"presets":[]}');
      expect(mocks.calls[0]?.url).toBe(`${BASE_URL}/api/presets`);
    });
  });

  describe("getProjectStatus", () => {
    it("passes the folder path as the 'path' query param", async () => {
      mocks.jsonOk('{"appliedModules":[]}');
      await expect(client.getProjectStatus("/tmp/myapp")).resolves.toBe('{"appliedModules":[]}');
      const url = mocks.calls[0]?.url ?? "";
      expect(url.startsWith(`${BASE_URL}/api/projects?path=`)).toBe(true);
      expect(decodeURIComponent(url.split("path=")[1] ?? "")).toBe("/tmp/myapp");
    });
  });

  describe("searchModules", () => {
    it("scores and orders matches with slug weighted highest", async () => {
      mocks.jsonOk(
        JSON.stringify({
          categories: [
            {
              name: "Build",
              modules: [
                { slug: "maven-java", description: "Maven build", tags: ["build", "java"] },
                { slug: "gradle-java", description: "Gradle build", tags: ["build", "java"] },
              ],
            },
            {
              name: "Persistence",
              modules: [
                {
                  slug: "jpa-postgresql",
                  description: "JPA + PostgreSQL",
                  tags: ["database", "sql"],
                },
              ],
            },
          ],
        }),
      );

      const result = JSON.parse(await client.searchModules("maven", 0));
      expect(result.query).toBe("maven");
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0].slug).toBe("maven-java");
      expect(result.matches[0].score).toBeGreaterThan(0);
    });

    it("respects the limit parameter", async () => {
      mocks.jsonOk(
        JSON.stringify({
          categories: [
            {
              name: "Build",
              modules: [
                { slug: "maven-java", description: "build", tags: [] },
                { slug: "maven-wrapper", description: "build", tags: [] },
                { slug: "maven-extra", description: "build", tags: [] },
              ],
            },
          ],
        }),
      );

      const result = JSON.parse(await client.searchModules("maven", 2));
      expect(result.matches).toHaveLength(2);
    });

    it("returns no matches for a blank query without calling seed4j", async () => {
      const result = JSON.parse(await client.searchModules("   ", 10));
      expect(result.matches).toEqual([]);
      expect(mocks.calls).toHaveLength(0);
    });
  });

  describe("refreshCatalogueCache", () => {
    it("clears all catalogue cache entries by default", async () => {
      mocks.jsonOk('{"categories":[]}');
      mocks.jsonOk('{"presets":[]}');
      mocks.jsonOk('{"levels":[]}');
      await client.listModules();
      await client.listPresets();
      await client.getModulesLandscape();

      const result = JSON.parse(client.refreshCatalogueCache());
      expect(result).toEqual({
        refreshed: "all",
        clearedPaths: ["/api/modules", "/api/modules-landscape", "/api/presets"],
      });

      mocks.jsonOk('{"categories":["fresh"]}');
      await client.listModules();
      expect(mocks.calls.filter((call) => call.url.endsWith("/api/modules"))).toHaveLength(2);
    });

    it("clears only the targeted cache group", async () => {
      mocks.jsonOk('{"categories":[]}');
      mocks.jsonOk('{"presets":[]}');
      await client.listModules();
      await client.listPresets();

      const result = JSON.parse(client.refreshCatalogueCache("modules"));
      expect(result).toEqual({
        refreshed: "modules",
        clearedPaths: ["/api/modules"],
      });

      mocks.jsonOk('{"categories":["fresh"]}');
      await client.listModules();
      await client.listPresets();

      expect(mocks.calls.filter((call) => call.url.endsWith("/api/modules"))).toHaveLength(2);
      expect(mocks.calls.filter((call) => call.url.endsWith("/api/presets"))).toHaveLength(1);
    });
  });

  describe("getPresetDetails", () => {
    it("matches by name case-insensitively", async () => {
      mocks.jsonOk(
        JSON.stringify({
          presets: [
            {
              name: "Java Library with Maven",
              modules: [{ slug: "init" }, { slug: "maven-java" }],
            },
            { name: "Webapp", modules: [{ slug: "init" }] },
          ],
        }),
      );

      const result = JSON.parse(await client.getPresetDetails("java library with maven"));
      expect(result.name).toBe("Java Library with Maven");
      expect(result.modules).toHaveLength(2);
    });

    it("throws when the preset name does not match anything", async () => {
      mocks.jsonOk('{"presets":[]}');
      await expect(client.getPresetDetails("Unknown")).rejects.toThrow(/Unknown/);
    });

    it("rejects a blank preset name", async () => {
      await expect(client.getPresetDetails("  ")).rejects.toThrow();
      expect(mocks.calls).toHaveLength(0);
    });
  });

  describe("planStack", () => {
    it("returns matching preset and module candidates with dependency and property hints", async () => {
      mocks.jsonOk(
        JSON.stringify({
          presets: [
            {
              name: "Java Library with Maven",
              modules: [{ slug: "init" }, { slug: "maven-java" }],
            },
            { name: "Webapp", modules: [{ slug: "init" }] },
          ],
        }),
      );
      mocks.jsonOk(
        JSON.stringify({
          categories: [
            {
              name: "Build",
              modules: [
                {
                  slug: "maven-java",
                  description: "Maven build for Java",
                  tags: ["build", "java"],
                },
              ],
            },
          ],
        }),
      );
      mocks.jsonOk(
        JSON.stringify({
          levels: [
            {
              elements: [
                { type: "MODULE", slug: "init", operation: "INIT", dependencies: [] },
                {
                  type: "MODULE",
                  slug: "maven-java",
                  operation: "ADD",
                  dependencies: [{ type: "MODULE", slug: "init" }],
                },
              ],
            },
          ],
        }),
      );
      mocks.jsonOk(
        JSON.stringify({
          definitions: [
            { key: "packageName", mandatory: true, type: "STRING" },
            { key: "javaVersion", mandatory: true, type: "STRING", default: "21" },
          ],
        }),
      );

      const result = JSON.parse(await client.planStack("Java Maven", 3));

      expect(result.query).toBe("Java Maven");
      expect(result.presetCandidates[0]).toMatchObject({
        name: "Java Library with Maven",
      });
      expect(result.moduleCandidates[0]).toMatchObject({
        slug: "maven-java",
        applicationOrder: ["init"],
        featureChoices: {},
        requiredProperties: [{ key: "packageName", type: "STRING", mandatory: true }],
        defaultedProperties: [
          { key: "javaVersion", type: "STRING", mandatory: true, default: "21" },
        ],
      });
      expect(result.nextSteps).toContain("Call preview_module before any apply tool.");
    });

    it("returns a warning for a blank stack description without fetching", async () => {
      const result = JSON.parse(await client.planStack("  "));

      expect(result.warnings).toEqual(["stackDescription is blank"]);
      expect(result.presetCandidates).toEqual([]);
      expect(result.moduleCandidates).toEqual([]);
      expect(mocks.calls).toHaveLength(0);
    });
  });

  describe("validateProperties", () => {
    it("flags missing mandatory keys and unknown keys", async () => {
      mocks.jsonOk(
        JSON.stringify({
          definitions: [
            { key: "packageName", mandatory: true, type: "STRING" },
            { key: "indentSize", mandatory: false, type: "INTEGER" },
          ],
        }),
      );

      const result = JSON.parse(
        await client.validateProperties("init", { indentSize: 2, extra: "x" }),
      );

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].key).toBe("packageName");
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].key).toBe("extra");
    });

    it("flags type mismatches", async () => {
      mocks.jsonOk(
        JSON.stringify({
          definitions: [
            { key: "indentSize", mandatory: true, type: "INTEGER" },
            { key: "verbose", mandatory: true, type: "BOOLEAN" },
          ],
        }),
      );

      const result = JSON.parse(
        await client.validateProperties("init", { indentSize: "not-a-number", verbose: "yes" }),
      );
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(2);
    });

    it("accepts a valid payload with no errors or warnings", async () => {
      mocks.jsonOk(
        JSON.stringify({
          definitions: [
            { key: "packageName", mandatory: true, type: "STRING" },
            { key: "indentSize", mandatory: false, type: "INTEGER" },
          ],
        }),
      );

      const result = JSON.parse(
        await client.validateProperties("init", { packageName: "com.example.app", indentSize: 4 }),
      );
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it("accepts a numeric string for an INTEGER property", async () => {
      mocks.jsonOk(
        JSON.stringify({
          definitions: [{ key: "indentSize", mandatory: true, type: "INTEGER" }],
        }),
      );

      const result = JSON.parse(await client.validateProperties("init", { indentSize: "4" }));
      expect(result.valid).toBe(true);
    });

    it("accepts an ENUM value present in enumValues", async () => {
      mocks.jsonOk(
        JSON.stringify({
          definitions: [
            { key: "buildTool", mandatory: true, type: "ENUM", enumValues: ["MAVEN", "GRADLE"] },
          ],
        }),
      );

      const result = JSON.parse(await client.validateProperties("init", { buildTool: "MAVEN" }));
      expect(result.valid).toBe(true);
    });

    it("rejects an ENUM value not in the allowed set and lists the allowed values", async () => {
      mocks.jsonOk(
        JSON.stringify({
          definitions: [
            { key: "buildTool", mandatory: true, type: "ENUM", enumValues: ["MAVEN", "GRADLE"] },
          ],
        }),
      );

      const result = JSON.parse(await client.validateProperties("init", { buildTool: "sbt" }));
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].key).toBe("buildTool");
      expect(result.errors[0].issue).toContain("MAVEN");
      expect(result.errors[0].issue).toContain("GRADLE");
      expect(result.errors[0].issue).toContain("sbt");
    });

    it("supports the alternate 'values' field name for ENUM", async () => {
      mocks.jsonOk(
        JSON.stringify({
          definitions: [{ key: "language", type: "ENUM", values: ["en", "fr"] }],
        }),
      );

      const okResult = JSON.parse(await client.validateProperties("init", { language: "fr" }));
      expect(okResult.valid).toBe(true);
    });

    it("rejects a STRING value that does not match its pattern", async () => {
      mocks.jsonOk(
        JSON.stringify({
          definitions: [
            {
              key: "packageName",
              mandatory: true,
              type: "STRING",
              pattern: "^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)*$",
            },
          ],
        }),
      );

      const result = JSON.parse(
        await client.validateProperties("init", { packageName: "Foo Bar" }),
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0].issue).toContain("pattern");
      expect(result.errors[0].issue).toContain("Foo Bar");
    });

    it("accepts a STRING value that matches its pattern", async () => {
      mocks.jsonOk(
        JSON.stringify({
          definitions: [
            {
              key: "packageName",
              mandatory: true,
              type: "STRING",
              pattern: "^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)*$",
            },
          ],
        }),
      );

      const result = JSON.parse(
        await client.validateProperties("init", { packageName: "com.example.app" }),
      );
      expect(result.valid).toBe(true);
    });

    it("silently skips an unparseable pattern (no false error)", async () => {
      mocks.jsonOk(
        JSON.stringify({
          definitions: [
            {
              key: "label",
              mandatory: true,
              type: "STRING",
              pattern: "[invalid(regex",
            },
          ],
        }),
      );

      const result = JSON.parse(
        await client.validateProperties("init", { label: "anything goes" }),
      );
      expect(result.valid).toBe(true);
    });

    it("records defaultsApplied for an optional missing key with a default", async () => {
      mocks.jsonOk(
        JSON.stringify({
          definitions: [{ key: "indentSize", type: "INTEGER", default: 2 }],
        }),
      );

      const result = JSON.parse(await client.validateProperties("init", {}));
      expect(result.valid).toBe(true);
      expect(result.defaultsApplied).toEqual([{ key: "indentSize", default: 2 }]);
    });

    it("records defaultsApplied — not errors — for a mandatory missing key with a default", async () => {
      mocks.jsonOk(
        JSON.stringify({
          definitions: [
            { key: "javaVersion", mandatory: true, type: "STRING", defaultValue: "21" },
          ],
        }),
      );

      const result = JSON.parse(await client.validateProperties("init", {}));
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.defaultsApplied).toEqual([{ key: "javaVersion", default: "21" }]);
    });

    it("keeps mandatory missing + no default as an error", async () => {
      mocks.jsonOk(
        JSON.stringify({
          definitions: [{ key: "packageName", mandatory: true, type: "STRING" }],
        }),
      );

      const result = JSON.parse(await client.validateProperties("init", {}));
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].key).toBe("packageName");
      expect(result.defaultsApplied).toEqual([]);
    });

    it("populates errors, warnings, and defaultsApplied together", async () => {
      mocks.jsonOk(
        JSON.stringify({
          definitions: [
            { key: "buildTool", mandatory: true, type: "ENUM", enumValues: ["MAVEN", "GRADLE"] },
            { key: "indentSize", type: "INTEGER", default: 2 },
            { key: "packageName", mandatory: true, type: "STRING" },
          ],
        }),
      );

      const result = JSON.parse(
        await client.validateProperties("init", {
          buildTool: "sbt",
          packageName: "com.example.app",
          rogue: true,
        }),
      );
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].key).toBe("buildTool");
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].key).toBe("rogue");
      expect(result.defaultsApplied).toEqual([{ key: "indentSize", default: 2 }]);
    });
  });

  describe("applyModule", () => {
    it("POSTs the expected envelope to apply-patch", async () => {
      mocks.jsonOk('{"status":"ok"}');

      const result = await client.applyModule("maven-java", "/tmp/app", {
        packageName: "com.example.app",
      });

      expect(result).toBe('{"status":"ok"}');
      const call = mocks.calls[0];
      expect(call?.url).toBe(`${BASE_URL}/api/modules/maven-java/apply-patch`);
      expect(call?.method).toBe("POST");
      expect(JSON.parse(call?.body ?? "{}")).toEqual({
        projectFolder: "/tmp/app",
        commit: false,
        parameters: { packageName: "com.example.app" },
      });
    });

    it("forwards commit: true into the apply-patch body", async () => {
      mocks.jsonOk('{"status":"ok"}');
      await client.applyModule("maven-java", "/tmp/app", {}, true);
      expect(JSON.parse(mocks.calls[0]?.body ?? "{}").commit).toBe(true);
    });

    it("rejects a relative project folder before posting", async () => {
      await expect(client.applyModule("maven-java", "relative/app", {})).rejects.toThrow(
        /absolute path/,
      );
      expect(mocks.calls).toHaveLength(0);
    });

    it("rejects the filesystem root before posting", async () => {
      await expect(
        client.applyModule("maven-java", path.parse(process.cwd()).root, {}),
      ).rejects.toThrow(/filesystem root/);
      expect(mocks.calls).toHaveLength(0);
    });
  });

  describe("applyModules", () => {
    it("applies every step in order when each succeeds", async () => {
      mocks.jsonOk('{"step":1}');
      mocks.jsonOk('{"step":2}');

      const result = JSON.parse(
        await client.applyModules("/tmp/app", [
          { slug: "init", properties: {} },
          { slug: "maven-java", properties: {} },
        ]),
      );

      expect(result.appliedCount).toBe(2);
      expect(result.failure).toBeNull();
      expect(result.remaining).toEqual([]);
      expect(result.applied).toHaveLength(2);
    });

    it("stops at the first failure and reports remaining slugs", async () => {
      mocks.jsonOk('{"step":1}');
      mocks.badRequest("boom");

      const result = JSON.parse(
        await client.applyModules("/tmp/app", [
          { slug: "init", properties: {} },
          { slug: "broken", properties: {} },
          { slug: "never-tried", properties: {} },
        ]),
      );

      expect(result.appliedCount).toBe(1);
      expect(result.failure.slug).toBe("broken");
      expect(result.failure.status).toBe(400);
      expect(result.failure.body).toContain("boom");
      expect(result.remaining).toEqual(["never-tried"]);
    });

    it("rejects an empty step list", async () => {
      await expect(client.applyModules("/tmp/app", [])).rejects.toThrow();
    });

    it("rejects an unsafe project folder before applying any step", async () => {
      await expect(
        client.applyModules("relative/app", [{ slug: "init", properties: {} }]),
      ).rejects.toThrow(/absolute path/);
      expect(mocks.calls).toHaveLength(0);
    });

    it("forwards commit: true to every step's POST body", async () => {
      mocks.jsonOk('{"step":1}');
      mocks.jsonOk('{"step":2}');
      await client.applyModules(
        "/tmp/app",
        [
          { slug: "init", properties: {} },
          { slug: "maven-java", properties: {} },
        ],
        true,
      );
      expect(JSON.parse(mocks.calls[0]?.body ?? "{}").commit).toBe(true);
      expect(JSON.parse(mocks.calls[1]?.body ?? "{}").commit).toBe(true);
    });
  });

  describe("applyPreset", () => {
    it("resolves a preset and applies every module with shared properties", async () => {
      mocks.jsonOk(
        JSON.stringify({
          presets: [
            {
              name: "Java Library with Maven",
              modules: [{ slug: "init" }, { slug: "maven-java" }],
            },
          ],
        }),
      );
      mocks.jsonOk('{"step":1}');
      mocks.jsonOk('{"step":2}');

      const result = JSON.parse(
        await client.applyPreset("Java Library with Maven", "/tmp/app", {
          packageName: "com.example.app",
        }),
      );

      expect(result.appliedCount).toBe(2);
      expect(result.failure).toBeNull();
      const second = mocks.calls[2];
      expect(JSON.parse(second?.body ?? "{}").parameters).toEqual({
        packageName: "com.example.app",
      });
    });

    it("forwards commit: true to every preset module", async () => {
      mocks.jsonOk(
        JSON.stringify({
          presets: [
            {
              name: "Java Library with Maven",
              modules: [{ slug: "init" }, { slug: "maven-java" }],
            },
          ],
        }),
      );
      mocks.jsonOk('{"step":1}');
      mocks.jsonOk('{"step":2}');

      await client.applyPreset("Java Library with Maven", "/tmp/app", {}, true);

      expect(JSON.parse(mocks.calls[1]?.body ?? "{}").commit).toBe(true);
      expect(JSON.parse(mocks.calls[2]?.body ?? "{}").commit).toBe(true);
    });

    it("rejects an unsafe project folder before resolving the preset", async () => {
      await expect(
        client.applyPreset("Java Library with Maven", "relative/app", {}),
      ).rejects.toThrow(/absolute path/);
      expect(mocks.calls).toHaveLength(0);
    });
  });

  describe("createProject", () => {
    it("creates the project folder then applies the init module", async () => {
      const base = await mkdtemp(path.join(tmpdir(), "seed4j-mcp-"));
      const target = path.join(base, "proj");
      mocks.jsonOk('{"status":"ok"}');

      await client.createProject(target, { baseName: "myapp" });

      const info = await stat(target);
      expect(info.isDirectory()).toBe(true);
      expect(mocks.calls[0]?.url).toBe(`${BASE_URL}/api/modules/init/apply-patch`);
    });

    it("forwards commit: true to the init apply-patch body", async () => {
      const base = await mkdtemp(path.join(tmpdir(), "seed4j-mcp-"));
      const target = path.join(base, "proj");
      mocks.jsonOk('{"status":"ok"}');

      await client.createProject(target, {}, true);

      expect(JSON.parse(mocks.calls[0]?.body ?? "{}").commit).toBe(true);
    });

    it("rejects an unsafe project folder before creating directories", async () => {
      await expect(client.createProject("relative/app", {})).rejects.toThrow(/absolute path/);
      expect(mocks.calls).toHaveLength(0);
    });

    it("removes a folder it created when init fails before writing files", async () => {
      const base = await mkdtemp(path.join(tmpdir(), "seed4j-mcp-"));
      const target = path.join(base, "proj");
      mocks.badRequest("missing property");

      await expect(client.createProject(target, {})).rejects.toBeInstanceOf(HttpError);
      await expect(access(target)).rejects.toThrow();
    });

    it("keeps a pre-existing folder when init fails", async () => {
      const base = await mkdtemp(path.join(tmpdir(), "seed4j-mcp-"));
      const target = path.join(base, "proj");
      await mkdir(target);
      mocks.badRequest("missing property");

      await expect(client.createProject(target, {})).rejects.toBeInstanceOf(HttpError);
      const info = await stat(target);
      expect(info.isDirectory()).toBe(true);
    });
  });

  describe("removeModule", () => {
    type ModuleApply = (scratchDir: string, props: Record<string, unknown>) => Promise<void>;

    function removeFixture() {
      const tmp: string[] = [];

      const newTmp = async (prefix = "remove-test-") => {
        const dir = await mkdtemp(path.join(tmpdir(), prefix));
        tmp.push(dir);
        return dir;
      };

      const cleanup = async () => {
        for (const dir of tmp) {
          await rm(dir, { recursive: true, force: true });
        }
      };

      const buildClient = (applies: Record<string, ModuleApply>) => {
        const fetcher: FetchLike = vi.fn(async (input, init) => {
          const url = input.toString();
          const match = url.match(/\/api\/modules\/([^/]+)\/apply-patch$/);
          if (!match) throw new Error(`unexpected url ${url}`);
          const slug = decodeURIComponent(match[1]!);
          const body = JSON.parse(init?.body as string) as {
            projectFolder?: string;
            parameters?: Record<string, unknown>;
          };
          const handler = applies[slug];
          if (handler && body.projectFolder) {
            await handler(body.projectFolder, body.parameters ?? {});
          }
          return new Response('{"status":"ok"}', { status: 200 });
        });
        return new Seed4jClient(BASE_URL, fetcher, { retries: 0 });
      };

      async function plantHistory(
        projectFolder: string,
        actions: Array<{ module: string; properties?: Record<string, unknown> }>,
      ) {
        const dir = path.join(projectFolder, ".seed4j", "modules");
        await mkdir(dir, { recursive: true });
        const file = path.join(dir, "history.json");
        await writeFile(
          file,
          JSON.stringify(
            {
              actions: actions.map((a, i) => ({
                module: a.module,
                date: `2026-05-29T11:00:${String(i).padStart(2, "0")}Z`,
                properties: a.properties ?? {},
              })),
            },
            null,
            2,
          ),
        );
      }

      async function plantModuleFileHistory(
        projectFolder: string,
        actions: Array<{ module: string; properties?: Record<string, unknown> }>,
      ) {
        const dir = path.join(projectFolder, ".seed4j", "modules");
        await mkdir(dir, { recursive: true });
        for (const [i, action] of actions.entries()) {
          const date = `2026-06-09T19:50:${String(i).padStart(2, "0")}Z`;
          const timestamp = `202606091950${String(i).padStart(5, "0")}`;
          await writeFile(
            path.join(dir, `${timestamp}-${action.module}.json`),
            JSON.stringify(
              {
                module: action.module,
                date,
                properties: action.properties ?? {},
              },
              null,
              2,
            ),
          );
        }
      }

      return { newTmp, cleanup, buildClient, plantHistory, plantModuleFileHistory };
    }

    it("returns action: 'not-applied' when history.json is missing", async () => {
      const fx = removeFixture();
      try {
        const projectFolder = await fx.newTmp();
        const remover = fx.buildClient({});

        const payload = JSON.parse(await remover.removeModule("maven-java", projectFolder, {}));
        expect(payload.action).toBe("not-applied");
      } finally {
        await fx.cleanup();
      }
    });

    it("rejects an unsafe project folder before reading history", async () => {
      const fx = removeFixture();
      try {
        const remover = fx.buildClient({});
        await expect(remover.removeModule("maven-java", "relative/app", {})).rejects.toThrow(
          /absolute path/,
        );
      } finally {
        await fx.cleanup();
      }
    });

    it("returns action: 'not-applied' when the slug is not in history", async () => {
      const fx = removeFixture();
      try {
        const projectFolder = await fx.newTmp();
        await fx.plantHistory(projectFolder, [{ module: "init" }, { module: "maven-java" }]);
        const remover = fx.buildClient({});

        const payload = JSON.parse(await remover.removeModule("spring-boot", projectFolder, {}));
        expect(payload.action).toBe("not-applied");
      } finally {
        await fx.cleanup();
      }
    });

    it("preview returns filesToDelete for a clean-install added file", async () => {
      const fx = removeFixture();
      try {
        const projectFolder = await fx.newTmp();
        await fx.plantHistory(projectFolder, [
          { module: "init" },
          { module: "maven-java", properties: { packageName: "com.example" } },
        ]);
        await writeFile(path.join(projectFolder, "pom.xml"), "<maven/>");

        const remover = fx.buildClient({
          init: async () => undefined,
          "maven-java": async (dir) => {
            await writeFile(path.join(dir, "pom.xml"), "<maven/>");
          },
        });

        const payload = JSON.parse(await remover.removeModule("maven-java", projectFolder, {}));
        expect(payload.action).toBe("preview");
        expect(payload.filesToDelete).toEqual([{ path: "pom.xml", sizeBytes: "<maven/>".length }]);
        expect(payload.locallyModifiedFiles).toEqual([]);
        expect(payload.historyUpdate).toEqual({ currentActions: 2, afterRemoval: 1 });

        const stillThere = await readFile(path.join(projectFolder, "pom.xml"), "utf8");
        expect(stillThere).toBe("<maven/>");
      } finally {
        await fx.cleanup();
      }
    });

    it("reads timestamped module history files when history.json is absent", async () => {
      const fx = removeFixture();
      try {
        const projectFolder = await fx.newTmp();
        await fx.plantModuleFileHistory(projectFolder, [
          { module: "init", properties: { baseName: "demo" } },
          { module: "maven-java", properties: { packageName: "com.example" } },
        ]);
        await writeFile(path.join(projectFolder, "pom.xml"), "<maven/>");

        const capturedProperties: Array<{ slug: string; props: Record<string, unknown> }> = [];
        const remover = fx.buildClient({
          init: async (_dir, props) => {
            capturedProperties.push({ slug: "init", props });
          },
          "maven-java": async (dir, props) => {
            capturedProperties.push({ slug: "maven-java", props });
            await writeFile(path.join(dir, "pom.xml"), "<maven/>");
          },
        });

        const payload = JSON.parse(await remover.removeModule("maven-java", projectFolder, {}));
        expect(payload.action).toBe("preview");
        expect(payload.filesToDelete).toEqual([{ path: "pom.xml", sizeBytes: "<maven/>".length }]);
        expect(payload.historyUpdate).toEqual({ currentActions: 2, afterRemoval: 1 });
        expect(capturedProperties.filter((c) => c.slug === "init")[0]?.props).toEqual({
          baseName: "demo",
        });
        expect(capturedProperties.filter((c) => c.slug === "maven-java")[0]?.props).toEqual({
          packageName: "com.example",
        });
      } finally {
        await fx.cleanup();
      }
    });

    it("preview flags a locally-modified added file (not in filesToDelete)", async () => {
      const fx = removeFixture();
      try {
        const projectFolder = await fx.newTmp();
        await fx.plantHistory(projectFolder, [{ module: "init" }, { module: "maven-java" }]);
        await writeFile(path.join(projectFolder, "pom.xml"), "<MODIFIED BY USER/>");

        const remover = fx.buildClient({
          init: async () => undefined,
          "maven-java": async (dir) => {
            await writeFile(path.join(dir, "pom.xml"), "<maven/>");
          },
        });

        const payload = JSON.parse(await remover.removeModule("maven-java", projectFolder, {}));
        expect(payload.action).toBe("preview");
        expect(payload.filesToDelete).toEqual([]);
        expect(payload.locallyModifiedFiles).toHaveLength(1);
        expect(payload.locallyModifiedFiles[0]).toMatchObject({
          path: "pom.xml",
          kind: "added",
          installedSizeBytes: "<maven/>".length,
        });
      } finally {
        await fx.cleanup();
      }
    });

    it("preview returns filesToRevert when the target modified an existing file (clean install)", async () => {
      const fx = removeFixture();
      try {
        const projectFolder = await fx.newTmp();
        await fx.plantHistory(projectFolder, [{ module: "init" }, { module: "maven-java" }]);
        await writeFile(path.join(projectFolder, ".gitignore"), "node_modules\ntarget\n");

        const remover = fx.buildClient({
          init: async (dir) => {
            await writeFile(path.join(dir, ".gitignore"), "node_modules\n");
          },
          "maven-java": async (dir) => {
            await writeFile(path.join(dir, ".gitignore"), "node_modules\ntarget\n");
          },
        });

        const payload = JSON.parse(await remover.removeModule("maven-java", projectFolder, {}));
        expect(payload.action).toBe("preview");
        expect(payload.filesToRevert).toEqual([
          {
            path: ".gitignore",
            currentSizeBytes: "node_modules\ntarget\n".length,
            revertedSizeBytes: "node_modules\n".length,
          },
        ]);
      } finally {
        await fx.cleanup();
      }
    });

    it("preview compares final generated states when a later module rewrites the target file", async () => {
      const fx = removeFixture();
      try {
        const projectFolder = await fx.newTmp();
        await fx.plantHistory(projectFolder, [
          { module: "init" },
          { module: "maven-java" },
          { module: "spring-boot" },
        ]);
        await writeFile(path.join(projectFolder, "pom.xml"), "<spring/>");

        const remover = fx.buildClient({
          init: async () => undefined,
          "maven-java": async (dir) => {
            await writeFile(path.join(dir, "pom.xml"), "<maven/>");
          },
          "spring-boot": async (dir) => {
            await writeFile(path.join(dir, "pom.xml"), "<spring/>");
          },
        });

        const payload = JSON.parse(await remover.removeModule("maven-java", projectFolder, {}));
        expect(payload.action).toBe("preview");
        expect(payload.modulesReplayed).toBe(5);
        expect(payload.filesToDelete).toEqual([]);
        expect(payload.filesToRevert).toEqual([]);
        expect(payload.locallyModifiedFiles).toEqual([]);
      } finally {
        await fx.cleanup();
      }
    });

    it("confirm deletes clean files, reverts modified files, and updates history.json", async () => {
      const fx = removeFixture();
      try {
        const projectFolder = await fx.newTmp();
        await fx.plantHistory(projectFolder, [{ module: "init" }, { module: "maven-java" }]);
        await writeFile(path.join(projectFolder, "pom.xml"), "<maven/>");
        await writeFile(path.join(projectFolder, ".gitignore"), "node_modules\ntarget\n");
        await writeFile(path.join(projectFolder, "untouched.txt"), "keep me");

        const remover = fx.buildClient({
          init: async (dir) => {
            await writeFile(path.join(dir, ".gitignore"), "node_modules\n");
          },
          "maven-java": async (dir) => {
            await writeFile(path.join(dir, "pom.xml"), "<maven/>");
            await writeFile(path.join(dir, ".gitignore"), "node_modules\ntarget\n");
          },
        });

        const payload = JSON.parse(
          await remover.removeModule("maven-java", projectFolder, { confirm: true }),
        );
        expect(payload.action).toBe("removed");
        expect(payload.deleted).toEqual(["pom.xml"]);
        expect(payload.reverted).toEqual([".gitignore"]);
        expect(payload.historyUpdated).toBe(true);

        await expect(access(path.join(projectFolder, "pom.xml"))).rejects.toThrow();
        const reverted = await readFile(path.join(projectFolder, ".gitignore"), "utf8");
        expect(reverted).toBe("node_modules\n");
        const kept = await readFile(path.join(projectFolder, "untouched.txt"), "utf8");
        expect(kept).toBe("keep me");

        const history = JSON.parse(
          await readFile(path.join(projectFolder, ".seed4j", "modules", "history.json"), "utf8"),
        );
        expect(history.actions).toHaveLength(1);
        expect(history.actions[0].module).toBe("init");
      } finally {
        await fx.cleanup();
      }
    });

    it("confirm deletes the matching timestamped module history file", async () => {
      const fx = removeFixture();
      try {
        const projectFolder = await fx.newTmp();
        await fx.plantModuleFileHistory(projectFolder, [
          { module: "init" },
          { module: "maven-java" },
        ]);
        await writeFile(path.join(projectFolder, "pom.xml"), "<maven/>");

        const remover = fx.buildClient({
          init: async () => undefined,
          "maven-java": async (dir) => {
            await writeFile(path.join(dir, "pom.xml"), "<maven/>");
          },
        });

        const payload = JSON.parse(
          await remover.removeModule("maven-java", projectFolder, { confirm: true }),
        );
        expect(payload.action).toBe("removed");
        expect(payload.historyUpdated).toBe(true);

        await expect(
          access(
            path.join(projectFolder, ".seed4j", "modules", "20260609195000001-maven-java.json"),
          ),
        ).rejects.toThrow();
        await expect(
          access(path.join(projectFolder, ".seed4j", "modules", "20260609195000000-init.json")),
        ).resolves.toBeUndefined();
      } finally {
        await fx.cleanup();
      }
    });

    it("confirm without force skips locally-modified files and leaves them on disk", async () => {
      const fx = removeFixture();
      try {
        const projectFolder = await fx.newTmp();
        await fx.plantHistory(projectFolder, [{ module: "init" }, { module: "maven-java" }]);
        await writeFile(path.join(projectFolder, "pom.xml"), "<USER WROTE THIS/>");

        const remover = fx.buildClient({
          init: async () => undefined,
          "maven-java": async (dir) => {
            await writeFile(path.join(dir, "pom.xml"), "<maven/>");
          },
        });

        const payload = JSON.parse(
          await remover.removeModule("maven-java", projectFolder, { confirm: true }),
        );
        expect(payload.action).toBe("removed");
        expect(payload.deleted).toEqual([]);
        expect(payload.skippedLocallyModified).toEqual(["pom.xml"]);

        const stillThere = await readFile(path.join(projectFolder, "pom.xml"), "utf8");
        expect(stillThere).toBe("<USER WROTE THIS/>");
      } finally {
        await fx.cleanup();
      }
    });

    it("confirm with force deletes locally-modified added files too", async () => {
      const fx = removeFixture();
      try {
        const projectFolder = await fx.newTmp();
        await fx.plantHistory(projectFolder, [{ module: "init" }, { module: "maven-java" }]);
        await writeFile(path.join(projectFolder, "pom.xml"), "<USER WROTE THIS/>");

        const remover = fx.buildClient({
          init: async () => undefined,
          "maven-java": async (dir) => {
            await writeFile(path.join(dir, "pom.xml"), "<maven/>");
          },
        });

        const payload = JSON.parse(
          await remover.removeModule("maven-java", projectFolder, {
            confirm: true,
            force: true,
          }),
        );
        expect(payload.action).toBe("removed");
        expect(payload.deleted).toContain("pom.xml");
        expect(payload.skippedLocallyModified).toEqual([]);

        await expect(access(path.join(projectFolder, "pom.xml"))).rejects.toThrow();
      } finally {
        await fx.cleanup();
      }
    });

    it("replays each action with its OWN properties (not aggregated)", async () => {
      const fx = removeFixture();
      try {
        const projectFolder = await fx.newTmp();
        await fx.plantHistory(projectFolder, [
          { module: "init", properties: { baseName: "first" } },
          { module: "maven-java", properties: { packageName: "com.example.second" } },
        ]);

        const capturedProperties: Array<{ slug: string; props: Record<string, unknown> }> = [];
        const remover = fx.buildClient({
          init: async (_dir, props) => {
            capturedProperties.push({ slug: "init", props });
          },
          "maven-java": async (_dir, props) => {
            capturedProperties.push({ slug: "maven-java", props });
          },
        });

        await remover.removeModule("maven-java", projectFolder, {});

        const initProps = capturedProperties.filter((c) => c.slug === "init");
        const mavenProps = capturedProperties.filter((c) => c.slug === "maven-java");
        expect(initProps.length).toBeGreaterThan(0);
        expect(initProps[0]?.props).toEqual({ baseName: "first" });
        expect(mavenProps.length).toBeGreaterThan(0);
        expect(mavenProps[0]?.props).toEqual({ packageName: "com.example.second" });
      } finally {
        await fx.cleanup();
      }
    });

    it("cleans up scratch dirs when a mid-replay apply throws", async () => {
      const fx = removeFixture();
      try {
        const projectFolder = await fx.newTmp();
        await fx.plantHistory(projectFolder, [{ module: "init" }, { module: "maven-java" }]);

        const beforeScratches = new Set<string>();
        const fetcher: FetchLike = vi.fn(async (_input, init) => {
          const body = JSON.parse(init?.body as string) as { projectFolder?: string };
          if (body.projectFolder) beforeScratches.add(body.projectFolder);
          return new Response("boom", { status: 500 });
        });
        const failing = new Seed4jClient(BASE_URL, fetcher, { retries: 0 });

        await expect(failing.removeModule("maven-java", projectFolder, {})).rejects.toBeInstanceOf(
          HttpError,
        );

        for (const scratch of beforeScratches) {
          await expect(access(scratch)).rejects.toThrow();
        }
      } finally {
        await fx.cleanup();
      }
    });
  });

  describe("previewModule", () => {
    type ApplyEffect = (scratchDir: string) => Promise<void>;

    function previewFixture() {
      const tmp: string[] = [];

      const newTmp = async (prefix = "preview-test-") => {
        const dir = await mkdtemp(path.join(tmpdir(), prefix));
        tmp.push(dir);
        return dir;
      };

      const cleanup = async () => {
        for (const dir of tmp) {
          await rm(dir, { recursive: true, force: true });
        }
      };

      const buildClient = (apply: ApplyEffect) => {
        const fetcher: FetchLike = vi.fn(async (input, init) => {
          const url = input.toString();
          if (url.includes("/apply-patch")) {
            const body = JSON.parse(init?.body as string) as { projectFolder?: string };
            if (body.projectFolder) {
              await apply(body.projectFolder);
            }
            return new Response('{"status":"ok"}', { status: 200 });
          }
          throw new Error(`unexpected url ${url}`);
        });
        return new Seed4jClient(BASE_URL, fetcher, { retries: 0 });
      };

      return { newTmp, cleanup, buildClient };
    }

    it("returns mode: 'copy' with added/modified diff when the project exists", async () => {
      const fx = previewFixture();
      try {
        const projectFolder = await fx.newTmp();
        await writeFile(path.join(projectFolder, "pom.xml"), "<existing/>");
        await writeFile(path.join(projectFolder, "untouched.txt"), "stay");

        const previewer = fx.buildClient(async (scratchDir) => {
          await writeFile(path.join(scratchDir, "pom.xml"), "<modified/>");
          await mkdir(path.join(scratchDir, "src/main/java"), { recursive: true });
          await writeFile(path.join(scratchDir, "src/main/java/Foo.java"), "// new");
        });

        const payload = JSON.parse(await previewer.previewModule("maven-java", projectFolder, {}));
        expect(payload.mode).toBe("copy");
        expect(payload.projectFolder).toBe(projectFolder);
        expect(payload.changedFilesCount).toBe(2);
        const byPath = new Map(
          (payload.changes as Array<{ path: string }>).map((c) => [c.path, c]),
        );
        expect(byPath.get("pom.xml")).toMatchObject({
          kind: "modified",
          previousSizeBytes: "<existing/>".length,
          sizeBytes: "<modified/>".length,
        });
        expect(byPath.get("src/main/java/Foo.java")).toMatchObject({
          kind: "added",
          sizeBytes: "// new".length,
        });
        expect(byPath.has("untouched.txt")).toBe(false);
      } finally {
        await fx.cleanup();
      }
    });

    it("returns mode: 'empty' when the project folder does not exist", async () => {
      const fx = previewFixture();
      try {
        const base = await fx.newTmp();
        const missing = path.join(base, "does-not-exist");

        const previewer = fx.buildClient(async (scratchDir) => {
          await writeFile(path.join(scratchDir, ".gitignore"), "node_modules\n");
          await writeFile(path.join(scratchDir, "README.md"), "# hello");
        });

        const payload = JSON.parse(await previewer.previewModule("init", missing, {}));
        expect(payload.mode).toBe("empty");
        expect(payload.projectFolder).toBe(missing);
        expect(payload.changedFilesCount).toBe(2);
        const paths = (payload.changes as Array<{ path: string; kind: string }>).map((c) => c.path);
        expect(paths).toEqual([".gitignore", "README.md"]);
        for (const change of payload.changes as Array<{ kind: string }>) {
          expect(change.kind).toBe("added");
        }
      } finally {
        await fx.cleanup();
      }
    });

    it("flags a deleted file as kind: 'deleted'", async () => {
      const fx = previewFixture();
      try {
        const projectFolder = await fx.newTmp();
        await writeFile(path.join(projectFolder, "old.txt"), "removed me");

        const previewer = fx.buildClient(async (scratchDir) => {
          await rm(path.join(scratchDir, "old.txt"));
        });

        const payload = JSON.parse(await previewer.previewModule("delete-mod", projectFolder, {}));
        expect(payload.changes).toEqual([
          {
            path: "old.txt",
            kind: "deleted",
            sizeBytes: 0,
            previousSizeBytes: "removed me".length,
          },
        ]);
      } finally {
        await fx.cleanup();
      }
    });

    it("excludes .git/ on both sides of the diff", async () => {
      const fx = previewFixture();
      try {
        const projectFolder = await fx.newTmp();
        await mkdir(path.join(projectFolder, ".git"), { recursive: true });
        await writeFile(path.join(projectFolder, ".git/HEAD"), "ref: refs/heads/main\n");

        const previewer = fx.buildClient(async (scratchDir) => {
          await mkdir(path.join(scratchDir, ".git"), { recursive: true });
          await writeFile(path.join(scratchDir, ".git/HEAD"), "ref: refs/heads/other\n");
          await writeFile(path.join(scratchDir, "real.txt"), "hello");
        });

        const payload = JSON.parse(await previewer.previewModule("mod", projectFolder, {}));
        const paths = (payload.changes as Array<{ path: string }>).map((c) => c.path);
        expect(paths).toEqual(["real.txt"]);
      } finally {
        await fx.cleanup();
      }
    });

    it("returns an empty diff when the module makes no change", async () => {
      const fx = previewFixture();
      try {
        const projectFolder = await fx.newTmp();
        await writeFile(path.join(projectFolder, "stable.txt"), "unchanged");

        const previewer = fx.buildClient(async () => undefined);
        const payload = JSON.parse(await previewer.previewModule("noop", projectFolder, {}));
        expect(payload.changedFilesCount).toBe(0);
        expect(payload.changes).toEqual([]);
      } finally {
        await fx.cleanup();
      }
    });

    it("cleans up the scratch dir even when the underlying apply fails", async () => {
      const fx = previewFixture();
      try {
        const projectFolder = await fx.newTmp();
        await writeFile(path.join(projectFolder, "kept.txt"), "ok");

        const beforeScratch = new Set<string>();
        const fetcher: FetchLike = vi.fn(async (_input, init) => {
          const body = JSON.parse(init?.body as string) as { projectFolder?: string };
          if (body.projectFolder) beforeScratch.add(body.projectFolder);
          return new Response("boom", { status: 500 });
        });
        const failing = new Seed4jClient(BASE_URL, fetcher, { retries: 0 });

        await expect(failing.previewModule("mod", projectFolder, {})).rejects.toBeInstanceOf(
          HttpError,
        );

        for (const scratch of beforeScratch) {
          await expect(access(scratch)).rejects.toThrow();
        }
        const kept = await readFile(path.join(projectFolder, "kept.txt"), "utf8");
        expect(kept).toBe("ok");
      } finally {
        await fx.cleanup();
      }
    });

    it("never mutates the original project folder", async () => {
      const fx = previewFixture();
      try {
        const projectFolder = await fx.newTmp();
        await writeFile(path.join(projectFolder, "pom.xml"), "<original/>");

        const previewer = fx.buildClient(async (scratchDir) => {
          await writeFile(path.join(scratchDir, "pom.xml"), "<MUTATED/>");
          await writeFile(path.join(scratchDir, "extra.txt"), "added");
        });

        await previewer.previewModule("maven-java", projectFolder, {});

        const original = await readFile(path.join(projectFolder, "pom.xml"), "utf8");
        expect(original).toBe("<original/>");
        await expect(access(path.join(projectFolder, "extra.txt"))).rejects.toThrow();
      } finally {
        await fx.cleanup();
      }
    });
  });

  describe("request retries", () => {
    function serverError(body: string, status = 503) {
      return new Response(body, { status });
    }

    it("retries a GET on 5xx and returns the eventually-successful body", async () => {
      const sleep = vi.fn().mockResolvedValue(undefined);
      const responses = [
        serverError("starting"),
        serverError("starting"),
        new Response('{"categories":[]}', { status: 200 }),
      ];
      const fetcher: FetchLike = vi.fn(async () => responses.shift()!);
      const retrying = new Seed4jClient(BASE_URL, fetcher, {
        retries: 2,
        retryBaseDelayMs: 1,
        sleep,
      });

      await expect(retrying.listModules()).resolves.toBe('{"categories":[]}');
      expect(fetcher).toHaveBeenCalledTimes(3);
      expect(sleep).toHaveBeenCalledTimes(2);
    });

    it("exhausts retries and surfaces the last HttpError on persistent 5xx", async () => {
      const sleep = vi.fn().mockResolvedValue(undefined);
      const fetcher: FetchLike = vi.fn(async () => serverError("boom"));
      const retrying = new Seed4jClient(BASE_URL, fetcher, {
        retries: 2,
        retryBaseDelayMs: 1,
        sleep,
      });

      const error = await retrying.listModules().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(503);
      expect(fetcher).toHaveBeenCalledTimes(3);
    });

    it("does not retry a GET on 4xx", async () => {
      const sleep = vi.fn().mockResolvedValue(undefined);
      const fetcher: FetchLike = vi.fn(async () => new Response("nope", { status: 400 }));
      const retrying = new Seed4jClient(BASE_URL, fetcher, {
        retries: 5,
        retryBaseDelayMs: 1,
        sleep,
      });

      await expect(retrying.listModules()).rejects.toBeInstanceOf(HttpError);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    });

    it("retries on TimeoutError and surfaces it after exhausting attempts", async () => {
      const sleep = vi.fn().mockResolvedValue(undefined);
      const hangingFetch: FetchLike = vi.fn(
        (_input, init) =>
          new Promise<Response>((_, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            });
          }),
      );
      const retrying = new Seed4jClient(BASE_URL, hangingFetch, {
        retries: 1,
        retryBaseDelayMs: 1,
        timeoutMs: 5,
        sleep,
      });

      const error = await retrying.listModules().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(TimeoutError);
      expect(hangingFetch).toHaveBeenCalledTimes(2);
      expect(sleep).toHaveBeenCalledTimes(1);
    });

    it("does not retry POSTs (apply-patch) on 5xx", async () => {
      const sleep = vi.fn().mockResolvedValue(undefined);
      const fetcher: FetchLike = vi.fn(async () => serverError("boom"));
      const retrying = new Seed4jClient(BASE_URL, fetcher, {
        retries: 3,
        retryBaseDelayMs: 1,
        sleep,
      });

      await expect(retrying.applyModule("maven-java", "/tmp/app", {})).rejects.toBeInstanceOf(
        HttpError,
      );
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    });

    it("retries getProjectStatus (the inline GET) on 5xx", async () => {
      const sleep = vi.fn().mockResolvedValue(undefined);
      const responses = [
        serverError("starting"),
        new Response('{"appliedModules":[]}', { status: 200 }),
      ];
      const fetcher: FetchLike = vi.fn(async () => responses.shift()!);
      const retrying = new Seed4jClient(BASE_URL, fetcher, {
        retries: 2,
        retryBaseDelayMs: 1,
        sleep,
      });

      await expect(retrying.getProjectStatus("/tmp/app")).resolves.toBe('{"appliedModules":[]}');
      expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it("applies exponential backoff capped by retryMaxDelayMs", async () => {
      const sleep = vi.fn().mockResolvedValue(undefined);
      const fetcher: FetchLike = vi.fn(async () => serverError("boom"));
      const retrying = new Seed4jClient(BASE_URL, fetcher, {
        retries: 4,
        retryBaseDelayMs: 100,
        retryMaxDelayMs: 250,
        sleep,
      });

      await retrying.listModules().catch(() => undefined);
      const delays = sleep.mock.calls.map((call) => call[0] as number);
      expect(delays).toEqual([100, 200, 250, 250]);
    });
  });

  describe("ping", () => {
    function arrange(opts: {
      liveness: () => Promise<Response> | Response;
      version?: () => Promise<Response> | Response;
      now?: () => number;
    }) {
      const versionFactory = opts.version ?? (() => new Response("", { status: 404 }));
      const fetcher: FetchLike = vi.fn(async (input) => {
        const url = input.toString();
        if (url.endsWith("/api/modules")) {
          return opts.liveness();
        }
        if (url.endsWith("/management/info")) {
          return versionFactory();
        }
        throw new Error(`unexpected url ${url}`);
      });
      const pinger = new Seed4jClient(BASE_URL, fetcher, {
        now: opts.now ?? (() => 0),
        retries: 0,
      });
      return { fetcher, client: pinger };
    }

    it("returns reachable+ok with extracted version on a successful ping", async () => {
      const local = arrange({
        liveness: () => new Response('{"categories":[]}', { status: 200 }),
        version: () =>
          new Response(JSON.stringify({ build: { version: "1.2.3" } }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      });

      const payload = JSON.parse(await local.client.ping());
      expect(payload.reachable).toBe(true);
      expect(payload.ok).toBe(true);
      expect(payload.status).toBe(200);
      expect(payload.baseUrl).toBe(BASE_URL);
      expect(payload.endpoint).toBe("/api/modules");
      expect(payload.version).toBe("1.2.3");
      expect(typeof payload.latencyMs).toBe("number");
      expect(typeof payload.checkedAt).toBe("string");
    });

    it("reports reachable but not ok on a 4xx (e.g. auth missing)", async () => {
      const local = arrange({
        liveness: () => new Response("nope", { status: 401 }),
      });
      const payload = JSON.parse(await local.client.ping());
      expect(payload.reachable).toBe(true);
      expect(payload.ok).toBe(false);
      expect(payload.status).toBe(401);
    });

    it("reports unreachable with an error message when the fetch never resolves", async () => {
      const local = arrange({
        liveness: () =>
          new Promise<Response>((_, reject) => {
            setTimeout(() => reject(new Error("never")), 1000);
          }),
      });
      const pinger = local.client;
      const payload = JSON.parse(await pinger.ping(20));
      expect(payload.reachable).toBe(false);
      expect(payload.ok).toBe(false);
      expect(payload.status).toBeNull();
      expect(payload.error).toContain("timed out after 20ms");
    });

    it("returns version: null when /management/info 404s", async () => {
      const local = arrange({
        liveness: () => new Response('{"categories":[]}', { status: 200 }),
        version: () => new Response("nope", { status: 404 }),
      });
      const payload = JSON.parse(await local.client.ping());
      expect(payload.reachable).toBe(true);
      expect(payload.version).toBeNull();
    });

    it("returns version: null when /management/info returns invalid JSON", async () => {
      const local = arrange({
        liveness: () => new Response('{"categories":[]}', { status: 200 }),
        version: () => new Response("not json", { status: 200 }),
      });
      const payload = JSON.parse(await local.client.ping());
      expect(payload.version).toBeNull();
    });

    it("supports a top-level 'version' field in /management/info", async () => {
      const local = arrange({
        liveness: () => new Response("{}", { status: 200 }),
        version: () =>
          new Response(JSON.stringify({ version: "2.0.0" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      });
      const payload = JSON.parse(await local.client.ping());
      expect(payload.version).toBe("2.0.0");
    });

    it("does not populate the catalogue cache when pinging", async () => {
      const local = arrange({
        liveness: () => new Response('{"categories":[]}', { status: 200 }),
      });
      await local.client.ping();
      const cached = await local.client.listModules();
      expect(cached).toBe('{"categories":[]}');
      expect(local.fetcher).toHaveBeenCalledTimes(3);
    });

    it("does a real fetch even when /api/modules is already cached", async () => {
      const cache = mockFetcher();
      cache.jsonOk('{"categories":["cached"]}');
      const pinger = new Seed4jClient(BASE_URL, cache.fetcher, { retries: 0 });
      await pinger.listModules();

      const pingResponses: Array<Response> = [
        new Response('{"categories":["fresh"]}', { status: 200 }),
        new Response("", { status: 404 }),
      ];
      const directFetcher: FetchLike = vi.fn(async () => pingResponses.shift()!);
      const direct = new Seed4jClient(BASE_URL, directFetcher, { retries: 0 });
      const payload = JSON.parse(await direct.ping());
      expect(payload.ok).toBe(true);
      expect(directFetcher).toHaveBeenCalledTimes(2);
      cache.assertDrained();
    });
  });

  describe("logger events", () => {
    interface CapturedEvent {
      level: LogLevel;
      event: string;
      fields: Record<string, unknown>;
    }

    function recorder(): { logger: Logger; events: CapturedEvent[] } {
      const events: CapturedEvent[] = [];
      const logger: Logger = {
        log: (level, event, fields = {}) => {
          events.push({ level, event, fields });
        },
        close: () => undefined,
      };
      return { logger, events };
    }

    it("emits http.request + http.response on a successful GET", async () => {
      mocks.jsonOk('{"categories":[]}');
      const rec = recorder();
      const observed = new Seed4jClient(BASE_URL, mocks.fetcher, { logger: rec.logger });
      await observed.listModules();
      const events = rec.events.map((e) => e.event);
      expect(events).toContain("http.request");
      expect(events).toContain("http.response");
      const response = rec.events.find((e) => e.event === "http.response");
      expect(response?.fields.status).toBe(200);
      expect(response?.fields.path).toBe("/api/modules");
    });

    it("emits http.response with warn level on a non-2xx (no retry path)", async () => {
      mocks.badRequest("nope");
      const rec = recorder();
      const observed = new Seed4jClient(BASE_URL, mocks.fetcher, {
        logger: rec.logger,
        retries: 0,
      });
      await expect(observed.listModules()).rejects.toBeInstanceOf(HttpError);
      const response = rec.events.find((e) => e.event === "http.response");
      expect(response?.level).toBe("warn");
      expect(response?.fields.status).toBe(400);
    });

    it("emits http.timeout on a hung request", async () => {
      const rec = recorder();
      const hangingFetch: FetchLike = vi.fn(
        (_input, init) =>
          new Promise<Response>((_, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      );
      const observed = new Seed4jClient(BASE_URL, hangingFetch, {
        logger: rec.logger,
        timeoutMs: 15,
        retries: 0,
      });
      await expect(observed.listModules()).rejects.toBeInstanceOf(TimeoutError);
      const timeout = rec.events.find((e) => e.event === "http.timeout");
      expect(timeout?.level).toBe("warn");
      expect(timeout?.fields.timeoutMs).toBe(15);
    });

    it("emits http.retry with attempt + delay on a retried 5xx", async () => {
      const rec = recorder();
      const responses = [
        new Response("boom", { status: 503 }),
        new Response('{"categories":[]}', { status: 200 }),
      ];
      const fetcher: FetchLike = vi.fn(async () => responses.shift()!);
      const observed = new Seed4jClient(BASE_URL, fetcher, {
        logger: rec.logger,
        retries: 2,
        retryBaseDelayMs: 1,
        sleep: vi.fn().mockResolvedValue(undefined),
      });
      await observed.listModules();
      const retry = rec.events.find((e) => e.event === "http.retry");
      expect(retry?.level).toBe("info");
      expect(retry?.fields.attempt).toBe(1);
      expect(retry?.fields.delayMs).toBe(1);
      expect(String(retry?.fields.lastError)).toContain("HttpError");
    });

    it("emits cache.hit on a repeat list_modules and cache.populate on the first call", async () => {
      mocks.jsonOk('{"categories":[]}');
      const rec = recorder();
      const observed = new Seed4jClient(BASE_URL, mocks.fetcher, {
        logger: rec.logger,
        cacheTtlMs: 60_000,
        now: () => 1_000,
      });
      await observed.listModules();
      await observed.listModules();
      const events = rec.events.map((e) => `${e.event}:${e.fields.path ?? ""}`);
      expect(events).toContain("cache.populate:/api/modules");
      expect(events).toContain("cache.hit:/api/modules");
    });
  });

  describe("catalogue cache", () => {
    function cachingClient(opts: { ttl: number; now: () => number }) {
      const local = mockFetcher();
      const cached = new Seed4jClient(BASE_URL, local.fetcher, {
        cacheTtlMs: opts.ttl,
        now: opts.now,
      });
      return { ...local, client: cached };
    }

    it("serves a second listModules call from cache within the TTL", async () => {
      const local = cachingClient({ ttl: 60_000, now: () => 1_000 });
      local.jsonOk('{"categories":[]}');
      await expect(local.client.listModules()).resolves.toBe('{"categories":[]}');
      await expect(local.client.listModules()).resolves.toBe('{"categories":[]}');
      expect(local.calls).toHaveLength(1);
      local.assertDrained();
    });

    it("refetches once the TTL has expired", async () => {
      let now = 0;
      const local = cachingClient({ ttl: 60_000, now: () => now });
      local.jsonOk('{"categories":["first"]}');
      local.jsonOk('{"categories":["second"]}');
      now = 1_000;
      await expect(local.client.listModules()).resolves.toBe('{"categories":["first"]}');
      now = 61_001;
      await expect(local.client.listModules()).resolves.toBe('{"categories":["second"]}');
      expect(local.calls).toHaveLength(2);
      local.assertDrained();
    });

    it("lets searchModules benefit from the catalogue cache", async () => {
      const local = cachingClient({ ttl: 60_000, now: () => 1_000 });
      local.jsonOk(
        JSON.stringify({
          categories: [
            {
              name: "Build",
              modules: [{ slug: "maven-java", description: "Maven build", tags: ["build"] }],
            },
          ],
        }),
      );
      await local.client.searchModules("maven", 0);
      await local.client.searchModules("maven", 0);
      expect(local.calls).toHaveLength(1);
      local.assertDrained();
    });

    it("caches /api/presets across getPresetDetails and applyPreset", async () => {
      const local = cachingClient({ ttl: 60_000, now: () => 1_000 });
      local.jsonOk(
        JSON.stringify({
          presets: [
            {
              name: "Java Library with Maven",
              modules: [{ slug: "init" }, { slug: "maven-java" }],
            },
          ],
        }),
      );
      local.jsonOk('{"step":1}');
      local.jsonOk('{"step":2}');

      await local.client.getPresetDetails("Java Library with Maven");
      await local.client.applyPreset("Java Library with Maven", "/tmp/app", {});

      const presetsCalls = local.calls.filter((c) => c.url.endsWith("/api/presets"));
      expect(presetsCalls).toHaveLength(1);
      local.assertDrained();
    });

    it("caches /api/modules-landscape across getModuleDependencies repeats", async () => {
      const landscape = JSON.stringify({
        levels: [
          {
            elements: [
              {
                type: "MODULE",
                slug: "init",
                operation: "APPLY",
                rank: "RANK_S",
                dependencies: [],
              },
            ],
          },
          {
            elements: [
              {
                type: "MODULE",
                slug: "java-base",
                operation: "APPLY",
                rank: "RANK_B",
                dependencies: [{ type: "MODULE", slug: "init" }],
              },
            ],
          },
        ],
      });
      const local = cachingClient({ ttl: 60_000, now: () => 1_000 });
      local.jsonOk(landscape);
      await local.client.getModuleDependencies("java-base");
      await local.client.getModuleDependencies("java-base");
      expect(local.calls).toHaveLength(1);
      local.assertDrained();
    });

    it("does not cache per-slug GETs like /api/modules/{slug}", async () => {
      const local = cachingClient({ ttl: 60_000, now: () => 1_000 });
      local.jsonOk('{"definitions":[]}');
      local.jsonOk('{"definitions":[]}');
      await local.client.getModuleDetails("maven-java");
      await local.client.getModuleDetails("maven-java");
      expect(local.calls).toHaveLength(2);
      local.assertDrained();
    });

    it("clearCache() drops everything", async () => {
      const local = cachingClient({ ttl: 60_000, now: () => 1_000 });
      local.jsonOk('{"first":true}');
      local.jsonOk('{"second":true}');
      await local.client.listModules();
      local.client.clearCache();
      await local.client.listModules();
      expect(local.calls).toHaveLength(2);
      local.assertDrained();
    });

    it("clearCache(path) drops only that entry", async () => {
      const local = cachingClient({ ttl: 60_000, now: () => 1_000 });
      local.jsonOk('{"categories":[]}');
      local.jsonOk('{"presets":[]}');
      local.jsonOk('{"categories":[]}');
      await local.client.listModules();
      await local.client.listPresets();
      local.client.clearCache("/api/modules");
      await local.client.listModules();
      await local.client.listPresets();
      const moduleCalls = local.calls.filter((c) => c.url.endsWith("/api/modules"));
      const presetCalls = local.calls.filter((c) => c.url.endsWith("/api/presets"));
      expect(moduleCalls).toHaveLength(2);
      expect(presetCalls).toHaveLength(1);
      local.assertDrained();
    });

    it("cacheTtlMs: 0 disables caching", async () => {
      const local = cachingClient({ ttl: 0, now: () => 1_000 });
      local.jsonOk('{"a":1}');
      local.jsonOk('{"a":2}');
      await local.client.listModules();
      await local.client.listModules();
      expect(local.calls).toHaveLength(2);
      local.assertDrained();
    });

    it("does not cache failed responses", async () => {
      const sleep = vi.fn().mockResolvedValue(undefined);
      const responses = [
        new Response("boom", { status: 503 }),
        new Response("boom", { status: 503 }),
        new Response("boom", { status: 503 }),
        new Response('{"categories":[]}', { status: 200 }),
      ];
      const fetcher: FetchLike = vi.fn(async () => responses.shift()!);
      const failing = new Seed4jClient(BASE_URL, fetcher, {
        cacheTtlMs: 60_000,
        retries: 2,
        retryBaseDelayMs: 1,
        sleep,
        now: () => 1_000,
      });

      await expect(failing.listModules()).rejects.toBeInstanceOf(HttpError);
      await expect(failing.listModules()).resolves.toBe('{"categories":[]}');
      expect(fetcher).toHaveBeenCalledTimes(4);
    });
  });

  describe("authorization header", () => {
    it("sends Authorization on a GET when authHeader is set", async () => {
      mocks.jsonOk('{"categories":[]}');
      const authed = new Seed4jClient(BASE_URL, mocks.fetcher, {
        authHeader: "Bearer abc.def",
      });
      await authed.listModules();
      expect(mocks.calls[0]?.headers?.Authorization).toBe("Bearer abc.def");
    });

    it("sends Authorization on the apply-patch POST when authHeader is set", async () => {
      mocks.jsonOk('{"status":"ok"}');
      const authed = new Seed4jClient(BASE_URL, mocks.fetcher, {
        authHeader: "Basic dXNlcjpwYXNz",
      });
      await authed.applyModule("maven-java", "/tmp/app", {});
      expect(mocks.calls[0]?.headers?.Authorization).toBe("Basic dXNlcjpwYXNz");
    });

    it("does not add Authorization when authHeader is omitted", async () => {
      mocks.jsonOk('{"categories":[]}');
      await client.listModules();
      expect(mocks.calls[0]?.headers?.Authorization).toBeUndefined();
    });

    it("trims and ignores a whitespace-only authHeader", async () => {
      mocks.jsonOk('{"categories":[]}');
      const authed = new Seed4jClient(BASE_URL, mocks.fetcher, { authHeader: "   " });
      await authed.listModules();
      expect(mocks.calls[0]?.headers?.Authorization).toBeUndefined();
    });
  });

  describe("request timeouts", () => {
    it("rejects with TimeoutError when a GET never resolves", async () => {
      const hangingFetch: FetchLike = vi.fn(
        (_input, init) =>
          new Promise<Response>((_, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            });
          }),
      );
      const fastClient = new Seed4jClient(BASE_URL, hangingFetch, { timeoutMs: 20, retries: 0 });

      const error = await fastClient.listModules().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(TimeoutError);
      const timeoutError = error as TimeoutError;
      expect(timeoutError.url).toBe(`${BASE_URL}/api/modules`);
      expect(timeoutError.method).toBe("GET");
      expect(timeoutError.timeoutMs).toBe(20);
    });

    it("rejects with TimeoutError on a hanging POST and reports the method", async () => {
      const hangingFetch: FetchLike = vi.fn(
        (_input, init) =>
          new Promise<Response>((_, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            });
          }),
      );
      const fastClient = new Seed4jClient(BASE_URL, hangingFetch, { timeoutMs: 20, retries: 0 });

      const error = await fastClient
        .applyModule("maven-java", "/tmp/app", {})
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(TimeoutError);
      expect((error as TimeoutError).method).toBe("POST");
    });

    it("does not fire the timeout when the response is fast", async () => {
      mocks.jsonOk('{"categories":[]}');
      const fastClient = new Seed4jClient(BASE_URL, mocks.fetcher, { timeoutMs: 10_000 });
      await expect(fastClient.listModules()).resolves.toBe('{"categories":[]}');
    });

    it("propagates the abort signal to fetch", async () => {
      let observedSignal: AbortSignal | undefined;
      const captureFetch: FetchLike = vi.fn(async (_input, init) => {
        observedSignal = init?.signal ?? undefined;
        return new Response('{"categories":[]}', { status: 200 });
      });
      const observed = new Seed4jClient(BASE_URL, captureFetch);
      await observed.listModules();
      expect(observedSignal).toBeInstanceOf(AbortSignal);
    });
  });

  describe("getModuleDependencies", () => {
    it("returns the topological order and feature choices for a module", async () => {
      mocks.jsonOk(
        JSON.stringify({
          levels: [
            {
              elements: [
                {
                  type: "MODULE",
                  slug: "init",
                  operation: "APPLY",
                  rank: "RANK_S",
                  dependencies: [],
                },
              ],
            },
            {
              elements: [
                {
                  type: "FEATURE",
                  slug: "build-tool",
                  modules: [
                    {
                      type: "MODULE",
                      slug: "maven-java",
                      operation: "APPLY",
                      rank: "RANK_A",
                      dependencies: [{ type: "MODULE", slug: "init" }],
                    },
                    {
                      type: "MODULE",
                      slug: "gradle-java",
                      operation: "APPLY",
                      rank: "RANK_A",
                      dependencies: [{ type: "MODULE", slug: "init" }],
                    },
                  ],
                },
              ],
            },
            {
              elements: [
                {
                  type: "MODULE",
                  slug: "java-base",
                  operation: "APPLY",
                  rank: "RANK_B",
                  dependencies: [
                    { type: "MODULE", slug: "init" },
                    { type: "FEATURE", slug: "build-tool" },
                  ],
                },
              ],
            },
          ],
        }),
      );

      const result = JSON.parse(await client.getModuleDependencies("java-base"));

      expect(result.slug).toBe("java-base");
      expect(result.applicationOrder).toEqual(["init"]);
      expect(result.featureChoices["build-tool"]).toEqual(["maven-java", "gradle-java"]);
    });

    it("throws when the target module is not in the landscape", async () => {
      mocks.jsonOk('{"levels":[]}');
      await expect(client.getModuleDependencies("missing")).rejects.toThrow(/missing/);
    });
  });
});
