import { beforeEach, describe, expect, it, vi } from "vitest";

import { HttpError, TimeoutError, type Seed4jClient } from "../src/client.js";
import { buildTools } from "../src/tools.js";

type ClientMock = {
  [K in keyof Seed4jClient]: Seed4jClient[K] extends (...args: infer A) => infer R
    ? ReturnType<typeof vi.fn<A extends unknown[] ? A : never, R>>
    : Seed4jClient[K];
};

function createClientMock(): ClientMock {
  return {
    listModules: vi.fn(),
    getModuleDetails: vi.fn(),
    getModuleDependencies: vi.fn(),
    listPresets: vi.fn(),
    getPresetDetails: vi.fn(),
    searchModules: vi.fn(),
    getProjectStatus: vi.fn(),
    applyModule: vi.fn(),
    createProject: vi.fn(),
    validateProperties: vi.fn(),
    applyModules: vi.fn(),
    applyPreset: vi.fn(),
  } as unknown as ClientMock;
}

function findTool(client: Seed4jClient, name: string) {
  const tool = buildTools(client).find((t) => t.name === name);
  if (!tool) throw new Error(`Tool not registered: ${name}`);
  return tool;
}

async function invoke(client: Seed4jClient, name: string, input: Record<string, unknown> = {}) {
  const tool = findTool(client, name);
  const result = await tool.handler(input as never);
  return result.content[0]?.text;
}

async function invokeRaw(client: Seed4jClient, name: string, input: Record<string, unknown> = {}) {
  const tool = findTool(client, name);
  return tool.handler(input as never);
}

async function invokeError(
  client: Seed4jClient,
  name: string,
  input: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const result = await invokeRaw(client, name, input);
  expect(result.isError).toBe(true);
  const text = result.content[0]?.text ?? "";
  return JSON.parse(text) as Record<string, unknown>;
}

describe("MCP tool registry", () => {
  let mock: ClientMock;
  let client: Seed4jClient;

  beforeEach(() => {
    mock = createClientMock();
    client = mock as unknown as Seed4jClient;
  });

  it("exposes all expected tool names", () => {
    const names = buildTools(client).map((t) => t.name);
    expect(names).toEqual([
      "list_modules",
      "get_module_details",
      "get_module_dependencies",
      "list_presets",
      "get_preset_details",
      "search_modules",
      "get_project_status",
      "apply_module",
      "create_project",
      "validate_properties",
      "apply_modules",
      "apply_preset",
    ]);
  });

  it("each tool has a non-empty description", () => {
    for (const tool of buildTools(client)) {
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });

  it("list_modules delegates to the client", async () => {
    mock.listModules.mockResolvedValue('{"categories":[]}');
    await expect(invoke(client, "list_modules")).resolves.toBe('{"categories":[]}');
    expect(mock.listModules).toHaveBeenCalledOnce();
  });

  it("get_module_details passes the slug through", async () => {
    mock.getModuleDetails.mockResolvedValue("{}");
    await invoke(client, "get_module_details", { moduleSlug: "maven-java" });
    expect(mock.getModuleDetails).toHaveBeenCalledWith("maven-java");
  });

  it("get_module_dependencies passes the slug through", async () => {
    mock.getModuleDependencies.mockResolvedValue("{}");
    await invoke(client, "get_module_dependencies", { moduleSlug: "java-base" });
    expect(mock.getModuleDependencies).toHaveBeenCalledWith("java-base");
  });

  it("list_presets delegates to the client", async () => {
    mock.listPresets.mockResolvedValue('{"presets":[]}');
    await expect(invoke(client, "list_presets")).resolves.toBe('{"presets":[]}');
  });

  it("get_preset_details passes the preset name", async () => {
    mock.getPresetDetails.mockResolvedValue("{}");
    await invoke(client, "get_preset_details", { presetName: "Java Library with Maven" });
    expect(mock.getPresetDetails).toHaveBeenCalledWith("Java Library with Maven");
  });

  it("search_modules passes 0 when limit is omitted", async () => {
    mock.searchModules.mockResolvedValue("{}");
    await invoke(client, "search_modules", { query: "maven" });
    expect(mock.searchModules).toHaveBeenCalledWith("maven", 0);
  });

  it("search_modules forwards an explicit limit", async () => {
    mock.searchModules.mockResolvedValue("{}");
    await invoke(client, "search_modules", { query: "maven", limit: 5 });
    expect(mock.searchModules).toHaveBeenCalledWith("maven", 5);
  });

  it("get_project_status passes the folder", async () => {
    mock.getProjectStatus.mockResolvedValue("{}");
    await invoke(client, "get_project_status", { projectFolder: "/tmp/app" });
    expect(mock.getProjectStatus).toHaveBeenCalledWith("/tmp/app");
  });

  it("apply_module forwards properties as an object", async () => {
    mock.applyModule.mockResolvedValue('{"ok":true}');
    await invoke(client, "apply_module", {
      moduleSlug: "maven-java",
      projectFolder: "/tmp/app",
      properties: { packageName: "com.example.app", indent: 2 },
    });
    expect(mock.applyModule).toHaveBeenCalledWith("maven-java", "/tmp/app", {
      packageName: "com.example.app",
      indent: 2,
    });
  });

  it("apply_module defaults to an empty properties map when omitted", async () => {
    mock.applyModule.mockResolvedValue("{}");
    await invoke(client, "apply_module", { moduleSlug: "init", projectFolder: "/tmp/app" });
    expect(mock.applyModule).toHaveBeenCalledWith("init", "/tmp/app", {});
  });

  it("create_project parses properties and delegates", async () => {
    mock.createProject.mockResolvedValue('{"ok":true}');
    await invoke(client, "create_project", {
      projectFolder: "/tmp/app",
      properties: { baseName: "myapp" },
    });
    expect(mock.createProject).toHaveBeenCalledWith("/tmp/app", { baseName: "myapp" });
  });

  it("validate_properties forwards properties to the client", async () => {
    mock.validateProperties.mockResolvedValue('{"valid":true}');
    await invoke(client, "validate_properties", {
      moduleSlug: "init",
      properties: { baseName: "myapp" },
    });
    expect(mock.validateProperties).toHaveBeenCalledWith("init", { baseName: "myapp" });
  });

  it("apply_modules forwards the steps array", async () => {
    mock.applyModules.mockResolvedValue('{"appliedCount":2}');
    const steps = [
      { slug: "init", properties: { baseName: "myapp" } },
      { slug: "maven-java", properties: {} },
    ];
    await invoke(client, "apply_modules", { projectFolder: "/tmp/app", steps });
    expect(mock.applyModules).toHaveBeenCalledWith("/tmp/app", steps);
  });

  it("apply_preset forwards the shared properties map", async () => {
    mock.applyPreset.mockResolvedValue("{}");
    await invoke(client, "apply_preset", {
      presetName: "Java Library with Maven",
      projectFolder: "/tmp/app",
      properties: { packageName: "com.example.app" },
    });
    expect(mock.applyPreset).toHaveBeenCalledWith(
      "Java Library with Maven",
      "/tmp/app",
      { packageName: "com.example.app" },
    );
  });

  describe("structured tool errors", () => {
    it("wraps a 5xx HttpError into an isError payload with a server-side hint", async () => {
      mock.listModules.mockRejectedValue(
        new HttpError(503, "starting", "http://test/api/modules"),
      );
      const payload = await invokeError(client, "list_modules");

      expect(payload.error).toBe("http");
      expect(payload.tool).toBe("list_modules");
      expect(payload.status).toBe(503);
      expect(payload.endpoint).toBe("http://test/api/modules");
      expect(payload.bodyExcerpt).toBe("starting");
      expect(String(payload.hint)).toContain("server error");
    });

    it("wraps a 4xx HttpError with a client-side hint", async () => {
      mock.applyModule.mockRejectedValue(
        new HttpError(400, "bad input", "http://test/api/modules/foo/apply-patch"),
      );
      const payload = await invokeError(client, "apply_module", {
        moduleSlug: "foo",
        projectFolder: "/tmp/app",
      });

      expect(payload.error).toBe("http");
      expect(payload.status).toBe(400);
      expect(String(payload.hint)).toContain("check the tool inputs");
    });

    it("truncates a very long HttpError body to ~500 chars with a remaining-count suffix", async () => {
      const huge = "x".repeat(2000);
      mock.listModules.mockRejectedValue(
        new HttpError(500, huge, "http://test/api/modules"),
      );
      const payload = await invokeError(client, "list_modules");

      const excerpt = String(payload.bodyExcerpt);
      expect(excerpt.length).toBeLessThan(600);
      expect(excerpt.startsWith("x".repeat(500))).toBe(true);
      expect(excerpt).toContain("(1500 more chars)");
    });

    it("wraps a TimeoutError with endpoint, timeoutMs, and a timeout-specific hint", async () => {
      mock.listModules.mockRejectedValue(
        new TimeoutError("http://test/api/modules", "GET", 30000),
      );
      const payload = await invokeError(client, "list_modules");

      expect(payload.error).toBe("timeout");
      expect(payload.endpoint).toBe("GET http://test/api/modules");
      expect(payload.timeoutMs).toBe(30000);
      expect(String(payload.hint)).toContain("SEED4J_TIMEOUT_MS");
    });

    it("wraps a plain Error as a 'client' error with the original message", async () => {
      mock.getPresetDetails.mockRejectedValue(new Error("Preset not found: Foo"));
      const payload = await invokeError(client, "get_preset_details", {
        presetName: "Foo",
      });

      expect(payload.error).toBe("client");
      expect(payload.tool).toBe("get_preset_details");
      expect(payload.message).toBe("Preset not found: Foo");
    });

    it("wraps a non-Error throw as an 'unknown' error", async () => {
      mock.listModules.mockRejectedValue("string thrown");
      const payload = await invokeError(client, "list_modules");

      expect(payload.error).toBe("unknown");
      expect(payload.message).toBe("string thrown");
    });

    it("leaves successful calls unchanged (no isError flag)", async () => {
      mock.listModules.mockResolvedValue('{"categories":[]}');
      const result = await invokeRaw(client, "list_modules");
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toBe('{"categories":[]}');
    });
  });
});
