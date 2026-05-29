import { describe, expect, it } from "vitest";

import { buildPrompts, type PromptDefinition } from "../src/prompts.js";

function findPrompt(name: string): PromptDefinition {
  const prompt = buildPrompts().find((p) => p.name === name);
  if (!prompt) throw new Error(`Prompt not registered: ${name}`);
  return prompt;
}

function textOf(
  prompt: PromptDefinition,
  args: { stackDescription: string; projectFolder?: string },
) {
  const result = prompt.handler(args);
  expect(result.messages).toHaveLength(1);
  expect(result.messages[0]?.role).toBe("user");
  expect(result.messages[0]?.content.type).toBe("text");
  return result.messages[0]?.content.text ?? "";
}

function assertOrder(text: string, fragments: string[]): void {
  let cursor = -1;
  for (const fragment of fragments) {
    const index = text.indexOf(fragment, cursor + 1);
    expect(index, `expected "${fragment}" to appear after position ${cursor}`).toBeGreaterThan(
      cursor,
    );
    cursor = index;
  }
}

describe("MCP prompt registry", () => {
  it("exposes the two documented prompts", () => {
    const names = buildPrompts().map((p) => p.name);
    expect(names).toEqual(["seed4j-curated-stack", "seed4j-custom-stack"]);
  });

  it("each prompt declares a non-empty description", () => {
    for (const prompt of buildPrompts()) {
      expect(prompt.description.length).toBeGreaterThan(0);
    }
  });

  it("each prompt declares stackDescription (required) and projectFolder (optional)", () => {
    for (const prompt of buildPrompts()) {
      expect(prompt.argsSchema.stackDescription.safeParse("ok").success).toBe(true);
      expect(prompt.argsSchema.stackDescription.safeParse("").success).toBe(false);
      expect(prompt.argsSchema.projectFolder.safeParse(undefined).success).toBe(true);
      expect(prompt.argsSchema.projectFolder.safeParse("/tmp/x").success).toBe(true);
    }
  });
});

describe("seed4j-curated-stack handler", () => {
  it("interpolates the stack description and folder, and lists the documented flow in order", () => {
    const prompt = findPrompt("seed4j-curated-stack");
    const text = textOf(prompt, {
      stackDescription: "Java library with Maven",
      projectFolder: "/Users/a/projects/mylib",
    });
    expect(text).toContain('"Java library with Maven"');
    expect(text).toContain("/Users/a/projects/mylib");
    assertOrder(text, [
      "list_presets",
      "get_preset_details",
      "preview_module",
      "apply_preset",
      "get_project_status",
    ]);
    expect(text).toContain("ping_seed4j");
  });

  it("asks the user for a folder when none is supplied", () => {
    const prompt = findPrompt("seed4j-curated-stack");
    const text = textOf(prompt, { stackDescription: "Java library with Maven" });
    expect(text.toLowerCase()).toContain("ask the user");
    expect(text).toContain("not yet decided");
  });
});

describe("seed4j-custom-stack handler", () => {
  it("interpolates the stack description and folder, and lists the documented flow in order", () => {
    const prompt = findPrompt("seed4j-custom-stack");
    const text = textOf(prompt, {
      stackDescription: "Spring Boot + JPA + Liquibase",
      projectFolder: "/tmp/svc",
    });
    expect(text).toContain('"Spring Boot + JPA + Liquibase"');
    expect(text).toContain("/tmp/svc");
    assertOrder(text, [
      "search_modules",
      "get_module_dependencies",
      "validate_properties",
      "preview_module",
      "apply_modules",
      "get_project_status",
    ]);
  });

  it("explicitly mentions featureChoices disambiguation", () => {
    const prompt = findPrompt("seed4j-custom-stack");
    const text = textOf(prompt, {
      stackDescription: "anything",
      projectFolder: "/tmp/x",
    });
    expect(text).toContain("featureChoices");
    expect(text.toLowerCase()).toContain("ask the user");
  });

  it("asks the user for a folder when none is supplied", () => {
    const prompt = findPrompt("seed4j-custom-stack");
    const text = textOf(prompt, { stackDescription: "anything" });
    expect(text).toContain("not yet decided");
  });
});
