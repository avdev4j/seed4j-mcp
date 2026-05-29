import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createLogger, noopLogger } from "../src/logger.js";

describe("noopLogger", () => {
  it("returns a frozen singleton whose log/close are no-ops", () => {
    const a = noopLogger();
    const b = noopLogger();
    expect(a).toBe(b);
    expect(() => a.log("info", "event", { k: 1 })).not.toThrow();
    expect(() => a.close()).not.toThrow();
  });
});

describe("createLogger", () => {
  const cleanup: string[] = [];

  afterEach(async () => {
    for (const dir of cleanup.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  async function tmpFile(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), "seed4j-log-"));
    cleanup.push(dir);
    return path.join(dir, "seed4j.log");
  }

  it("returns the no-op singleton when filePath is undefined or blank", () => {
    expect(createLogger(undefined)).toBe(noopLogger());
    expect(createLogger("")).toBe(noopLogger());
    expect(createLogger("   ")).toBe(noopLogger());
  });

  it("appends one JSON line per log call with timestamp, level, event, and fields", async () => {
    const file = await tmpFile();
    const logger = createLogger(file, { now: () => 1717000000000 });
    logger.log("info", "http.request", { method: "GET", path: "/api/modules" });
    logger.log("warn", "http.timeout", { method: "POST", path: "/api/x", timeoutMs: 30000 });
    await new Promise<void>((resolve) => {
      logger.close();
      setTimeout(resolve, 30);
    });

    const raw = await readFile(file, "utf8");
    const lines = raw.trim().split("\n");
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0] ?? "{}");
    expect(first).toMatchObject({
      level: "info",
      event: "http.request",
      method: "GET",
      path: "/api/modules",
    });
    expect(typeof first.timestamp).toBe("string");
    expect(first.timestamp).toBe(new Date(1717000000000).toISOString());
    const second = JSON.parse(lines[1] ?? "{}");
    expect(second).toMatchObject({
      level: "warn",
      event: "http.timeout",
      timeoutMs: 30000,
    });
  });

  it("appends to an existing file (does not truncate)", async () => {
    const file = await tmpFile();
    const first = createLogger(file);
    first.log("info", "a");
    await new Promise<void>((resolve) => {
      first.close();
      setTimeout(resolve, 20);
    });
    const second = createLogger(file);
    second.log("info", "b");
    await new Promise<void>((resolve) => {
      second.close();
      setTimeout(resolve, 20);
    });

    const raw = await readFile(file, "utf8");
    const lines = raw.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] ?? "{}").event).toBe("a");
    expect(JSON.parse(lines[1] ?? "{}").event).toBe("b");
  });

  it("never throws when the path is unwritable; writes degrade via the stream's error event", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const logger = createLogger("/no-such-dir-seed4j/" + Math.random() + "/log.txt");
      expect(() => logger.log("info", "event")).not.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(() => logger.close()).not.toThrow();
      const stderrWrites = stderr.mock.calls.map((c) => String(c[0] ?? "")).join("");
      if (stderrWrites.length > 0) {
        expect(stderrWrites).toContain("seed4j-mcp");
      }
    } finally {
      stderr.mockRestore();
    }
  });
});
