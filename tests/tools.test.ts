import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Seed4jClient } from "../src/client.js";
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
});
