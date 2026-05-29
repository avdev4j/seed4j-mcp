import { beforeEach, describe, expect, it, vi } from "vitest";

import { Seed4jClient, type FetchLike } from "../src/client.js";
import { buildResources } from "../src/resources.js";

type ClientMock = {
  [K in keyof Seed4jClient]: Seed4jClient[K] extends (...args: infer A) => infer R
    ? ReturnType<typeof vi.fn<A extends unknown[] ? A : never, R>>
    : Seed4jClient[K];
};

function createClientMock(): ClientMock {
  return {
    listModules: vi.fn(),
    getModulesLandscape: vi.fn(),
    listPresets: vi.fn(),
  } as unknown as ClientMock;
}

describe("MCP resource registry", () => {
  let mock: ClientMock;
  let client: Seed4jClient;

  beforeEach(() => {
    mock = createClientMock();
    client = mock as unknown as Seed4jClient;
  });

  it("exposes the expected resource names and URIs", () => {
    const resources = buildResources(client);
    expect(resources.map((r) => r.name)).toEqual([
      "modules-catalogue",
      "modules-landscape",
      "presets-catalogue",
    ]);
    expect(resources.map((r) => r.uri)).toEqual([
      "seed4j://catalogue/modules",
      "seed4j://catalogue/landscape",
      "seed4j://catalogue/presets",
    ]);
  });

  it("each resource has a non-empty description and an application/json mime type", () => {
    for (const resource of buildResources(client)) {
      expect(resource.description.length).toBeGreaterThan(0);
      expect(resource.mimeType).toBe("application/json");
    }
  });

  it("modules-catalogue handler delegates to client.listModules", async () => {
    mock.listModules.mockResolvedValue('{"categories":[]}');
    const handler = buildResources(client).find((r) => r.name === "modules-catalogue")!.handler;
    await expect(handler()).resolves.toBe('{"categories":[]}');
    expect(mock.listModules).toHaveBeenCalledOnce();
  });

  it("modules-landscape handler delegates to client.getModulesLandscape", async () => {
    mock.getModulesLandscape.mockResolvedValue('{"levels":[]}');
    const handler = buildResources(client).find((r) => r.name === "modules-landscape")!.handler;
    await expect(handler()).resolves.toBe('{"levels":[]}');
    expect(mock.getModulesLandscape).toHaveBeenCalledOnce();
  });

  it("presets-catalogue handler delegates to client.listPresets", async () => {
    mock.listPresets.mockResolvedValue('{"presets":[]}');
    const handler = buildResources(client).find((r) => r.name === "presets-catalogue")!.handler;
    await expect(handler()).resolves.toBe('{"presets":[]}');
    expect(mock.listPresets).toHaveBeenCalledOnce();
  });
});

describe("MCP resources share the catalogue cache with the tools", () => {
  it("reading the same resource twice within the TTL fetches only once", async () => {
    const responses = new Map<string, string>([
      ["/api/modules", '{"categories":["x"]}'],
      ["/api/modules-landscape", '{"levels":["x"]}'],
      ["/api/presets", '{"presets":["x"]}'],
    ]);
    const fetcher: FetchLike = vi.fn(async (input) => {
      const url = input.toString();
      const path = new URL(url).pathname;
      const body = responses.get(path);
      if (body === undefined) throw new Error(`unexpected url ${url}`);
      return new Response(body, { status: 200 });
    });
    const cached = new Seed4jClient("http://test", fetcher, {
      cacheTtlMs: 60_000,
      now: () => 1_000,
    });

    const resources = buildResources(cached);
    for (const resource of resources) {
      await resource.handler();
      await resource.handler();
    }

    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("a tool call and a resource read share the same cache entry", async () => {
    const fetcher: FetchLike = vi.fn(
      async () => new Response('{"categories":[]}', { status: 200 }),
    );
    const cached = new Seed4jClient("http://test", fetcher, {
      cacheTtlMs: 60_000,
      now: () => 1_000,
    });
    const resource = buildResources(cached).find((r) => r.name === "modules-catalogue")!;

    await cached.listModules();
    await resource.handler();

    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
