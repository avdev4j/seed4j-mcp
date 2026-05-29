import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { HttpError, Seed4jClient, TimeoutError } from "../../src/client.js";
import {
  delayedRoute,
  jsonRoute,
  sequenceRoute,
  startServer,
  type MockServer,
} from "./server.js";

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

async function fixture(name: string): Promise<string> {
  return readFile(path.join(FIXTURES_DIR, name), "utf8");
}

describe("integration: Seed4jClient against a real local HTTP server", () => {
  let server: MockServer;
  let client: Seed4jClient;

  beforeEach(async () => {
    server = await startServer();
    client = new Seed4jClient(server.baseUrl);
  });

  afterEach(async () => {
    await server.close();
  });

  describe("read endpoints", () => {
    it("listModules returns the seed4j body verbatim", async () => {
      const body = await fixture("modules.json");
      server.setRoute("GET", "/api/modules", jsonRoute(body));

      const result = await client.listModules();
      expect(JSON.parse(result)).toEqual(JSON.parse(body));
      expect(server.requests).toHaveLength(1);
      expect(server.requests[0]?.method).toBe("GET");
      expect(server.requests[0]?.path).toBe("/api/modules");
    });

    it("getModuleDetails URL-encodes the slug into the path", async () => {
      const body = await fixture("module-maven-java.json");
      server.setRoute("GET", "/api/modules/maven-java", jsonRoute(body));

      const result = await client.getModuleDetails("maven-java");
      expect(JSON.parse(result).slug).toBe("maven-java");
      expect(server.requests[0]?.path).toBe("/api/modules/maven-java");
    });

    it("searchModules scores real catalogue payloads", async () => {
      server.setRoute("GET", "/api/modules", jsonRoute(await fixture("modules.json")));

      const result = JSON.parse(await client.searchModules("maven", 0));
      expect(result.matches.length).toBeGreaterThan(0);
      expect(result.matches[0].slug).toBe("maven-java");
    });

    it("getModuleDependencies walks the real landscape and reports featureChoices", async () => {
      server.setRoute(
        "GET",
        "/api/modules-landscape",
        jsonRoute(await fixture("modules-landscape.json")),
      );

      const result = JSON.parse(await client.getModuleDependencies("java-base"));
      expect(result.applicationOrder).toContain("init");
      expect(result.featureChoices["build-tool"]).toEqual(["maven-java", "gradle-java"]);
    });

    it("getProjectStatus passes the folder as a query param and parses { modules, properties }", async () => {
      const body = await fixture("project-status.json");
      server.setRoute("GET", "/api/projects", jsonRoute(body));

      const result = await client.getProjectStatus("/tmp/myapp");
      const parsed = JSON.parse(result);
      expect(parsed.modules).toEqual([{ slug: "init" }, { slug: "maven-java" }]);
      expect(parsed.properties.baseName).toBe("myapp");
      const requestPath = server.requests[0]?.path ?? "";
      expect(requestPath.startsWith("/api/projects?path=")).toBe(true);
      expect(decodeURIComponent(requestPath.split("path=")[1] ?? "")).toBe("/tmp/myapp");
    });
  });

  describe("validation", () => {
    it("validate_properties parses the real schema and surfaces enum + pattern violations", async () => {
      server.setRoute(
        "GET",
        "/api/modules/maven-java",
        jsonRoute(await fixture("module-maven-java.json")),
      );

      const result = JSON.parse(
        await client.validateProperties("maven-java", {
          packageName: "Bad Package Name",
          buildTool: "sbt",
        }),
      );
      expect(result.valid).toBe(false);
      const issuesByKey = new Map<string, string>(
        (result.errors as Array<{ key: string; issue: string }>).map((e) => [e.key, e.issue]),
      );
      expect(issuesByKey.get("packageName")).toContain("pattern");
      expect(issuesByKey.get("buildTool")).toContain("MAVEN");
    });
  });

  describe("write endpoints", () => {
    it("applyModule POSTs the exact { projectFolder, commit, parameters } envelope", async () => {
      server.setRoute(
        "POST",
        "/api/modules/maven-java/apply-patch",
        jsonRoute('{"status":"ok"}'),
      );

      const result = await client.applyModule(
        "maven-java",
        "/tmp/app",
        { packageName: "com.example.app" },
        true,
      );
      expect(JSON.parse(result).status).toBe("ok");

      const request = server.requests[0];
      expect(request?.method).toBe("POST");
      expect(request?.path).toBe("/api/modules/maven-java/apply-patch");
      expect(request?.headers["content-type"]).toBe("application/json");
      expect(JSON.parse(request?.body ?? "{}")).toEqual({
        projectFolder: "/tmp/app",
        commit: true,
        parameters: { packageName: "com.example.app" },
      });
    });

    it("applyModules fires N POSTs in order and stops at the first failure", async () => {
      server.setRoute("POST", "/api/modules/init/apply-patch", jsonRoute('{"step":1}'));
      server.setRoute(
        "POST",
        "/api/modules/broken/apply-patch",
        jsonRoute('{"error":"nope"}', 400),
      );

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
      expect(result.remaining).toEqual(["never-tried"]);
      expect(server.requests.map((r) => r.path)).toEqual([
        "/api/modules/init/apply-patch",
        "/api/modules/broken/apply-patch",
      ]);
    });

    it("applyPreset resolves /api/presets and then applies each module in order", async () => {
      server.setRoute("GET", "/api/presets", jsonRoute(await fixture("presets.json")));
      server.setRoute("POST", "/api/modules/init/apply-patch", jsonRoute('{"step":1}'));
      server.setRoute(
        "POST",
        "/api/modules/maven-java/apply-patch",
        jsonRoute('{"step":2}'),
      );

      const result = JSON.parse(
        await client.applyPreset("Java Library with Maven", "/tmp/app", {
          packageName: "com.example.app",
        }),
      );
      expect(result.appliedCount).toBe(2);
      const postPaths = server.requests
        .filter((r) => r.method === "POST")
        .map((r) => r.path);
      expect(postPaths).toEqual([
        "/api/modules/init/apply-patch",
        "/api/modules/maven-java/apply-patch",
      ]);
    });
  });

  describe("auth", () => {
    it("Authorization header set via authHeader reaches the wire on every call", async () => {
      const authed = new Seed4jClient(server.baseUrl, undefined, {
        authHeader: "Bearer abc.def",
      });
      server.setRoute("GET", "/api/modules", jsonRoute(await fixture("modules.json")));
      server.setRoute("POST", "/api/modules/init/apply-patch", jsonRoute('{"ok":true}'));

      await authed.listModules();
      await authed.applyModule("init", "/tmp/app", {});

      expect(server.requests[0]?.headers["authorization"]).toBe("Bearer abc.def");
      expect(server.requests[1]?.headers["authorization"]).toBe("Bearer abc.def");
    });
  });

  describe("retry + timeout against real sockets", () => {
    it("retries a 503 GET until it succeeds", async () => {
      server.setRoute(
        "GET",
        "/api/modules",
        sequenceRoute(
          jsonRoute("starting", 503),
          jsonRoute("starting", 503),
          jsonRoute('{"categories":[]}'),
        ),
      );
      const retrying = new Seed4jClient(server.baseUrl, undefined, {
        retries: 3,
        retryBaseDelayMs: 1,
      });
      await expect(retrying.listModules()).resolves.toBe('{"categories":[]}');
      expect(server.requests.filter((r) => r.path === "/api/modules")).toHaveLength(3);
    });

    it("throws TimeoutError when the server delays past the configured timeout", async () => {
      server.setRoute(
        "GET",
        "/api/modules",
        delayedRoute('{"categories":[]}', 200),
      );
      const fast = new Seed4jClient(server.baseUrl, undefined, {
        timeoutMs: 30,
        retries: 0,
      });
      const error = await fast.listModules().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(TimeoutError);
      expect((error as TimeoutError).timeoutMs).toBe(30);
    });

    it("does not retry a 400 GET (deterministic failure)", async () => {
      server.setRoute("GET", "/api/modules", jsonRoute("nope", 400));
      const retrying = new Seed4jClient(server.baseUrl, undefined, {
        retries: 5,
        retryBaseDelayMs: 1,
      });
      await expect(retrying.listModules()).rejects.toBeInstanceOf(HttpError);
      expect(server.requests).toHaveLength(1);
    });
  });

  describe("ping_seed4j", () => {
    it("returns reachable+ok and extracts the version from /management/info", async () => {
      server.setRoute("GET", "/api/modules", jsonRoute(await fixture("modules.json")));
      server.setRoute(
        "GET",
        "/management/info",
        jsonRoute(JSON.stringify({ build: { version: "1.2.3" } })),
      );

      const payload = JSON.parse(await client.ping());
      expect(payload.reachable).toBe(true);
      expect(payload.ok).toBe(true);
      expect(payload.status).toBe(200);
      expect(payload.version).toBe("1.2.3");
      expect(payload.baseUrl).toBe(server.baseUrl);
      expect(payload.endpoint).toBe("/api/modules");
    });
  });
});
