import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HttpError, Seed4jClient, TimeoutError, type FetchLike } from "../src/client.js";

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

  const badRequest = (body: string) =>
    enqueue(() => new Response(body, { status: 400 }));

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
                { slug: "jpa-postgresql", description: "JPA + PostgreSQL", tags: ["database", "sql"] },
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

  describe("getPresetDetails", () => {
    it("matches by name case-insensitively", async () => {
      mocks.jsonOk(
        JSON.stringify({
          presets: [
            { name: "Java Library with Maven", modules: [{ slug: "init" }, { slug: "maven-java" }] },
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
  });

  describe("applyPreset", () => {
    it("resolves a preset and applies every module with shared properties", async () => {
      mocks.jsonOk(
        JSON.stringify({
          presets: [
            { name: "Java Library with Maven", modules: [{ slug: "init" }, { slug: "maven-java" }] },
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
      const fastClient = new Seed4jClient(BASE_URL, hangingFetch, { timeoutMs: 20 });

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
      const fastClient = new Seed4jClient(BASE_URL, hangingFetch, { timeoutMs: 20 });

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
