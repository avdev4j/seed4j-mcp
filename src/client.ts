import { mkdir } from "node:fs/promises";

export type Properties = Record<string, unknown>;

export interface ApplyStep {
  slug: string;
  properties?: Properties;
}

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    readonly url: string,
  ) {
    super(`HTTP ${status} for ${url}: ${body}`);
    this.name = "HttpError";
  }
}

export class TimeoutError extends Error {
  constructor(
    readonly url: string,
    readonly method: string,
    readonly timeoutMs: number,
  ) {
    super(`seed4j request timed out after ${timeoutMs}ms: ${method} ${url}`);
    this.name = "TimeoutError";
  }
}

export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_RETRIES = 2;
export const DEFAULT_RETRY_BASE_DELAY_MS = 200;
export const DEFAULT_RETRY_MAX_DELAY_MS = 2_000;

export type SleepFn = (ms: number) => Promise<void>;

const defaultSleep: SleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

interface ValidationIssue {
  key: string;
  issue: string;
}

interface AppliedEntry {
  slug: string;
  response: string;
}

interface FailureEntry {
  slug: string;
  status: number;
  body: string;
}

export interface Seed4jClientOptions {
  timeoutMs?: number;
  retries?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
  sleep?: SleepFn;
  authHeader?: string;
}

export class Seed4jClient {
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly retryBaseDelayMs: number;
  private readonly retryMaxDelayMs: number;
  private readonly sleep: SleepFn;
  private readonly authHeader: string | undefined;

  constructor(
    private readonly baseUrl: string,
    private readonly fetcher: FetchLike = fetch,
    options: Seed4jClientOptions = {},
  ) {
    const requestedTimeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.timeoutMs = requestedTimeout > 0 ? requestedTimeout : DEFAULT_TIMEOUT_MS;

    const requestedRetries = options.retries ?? DEFAULT_RETRIES;
    this.retries = requestedRetries >= 0 ? Math.floor(requestedRetries) : 0;

    const requestedBase = options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
    this.retryBaseDelayMs = requestedBase > 0 ? requestedBase : DEFAULT_RETRY_BASE_DELAY_MS;

    const requestedMax = options.retryMaxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS;
    this.retryMaxDelayMs = requestedMax > 0 ? requestedMax : DEFAULT_RETRY_MAX_DELAY_MS;

    this.sleep = options.sleep ?? defaultSleep;
    this.authHeader = options.authHeader?.trim() || undefined;
  }

  listModules(): Promise<string> {
    return this.getText("/api/modules");
  }

  getModuleDetails(moduleSlug: string): Promise<string> {
    return this.getText(`/api/modules/${encodeURIComponent(moduleSlug)}`);
  }

  listPresets(): Promise<string> {
    return this.getText("/api/presets");
  }

  async getPresetDetails(presetName: string): Promise<string> {
    if (!presetName || !presetName.trim()) {
      throw new Error("Preset name is required");
    }
    const target = presetName.trim().toLowerCase();
    const presetsBody = JSON.parse(await this.listPresets()) as {
      presets?: Array<{ name?: string }>;
    };
    const match = (presetsBody.presets ?? []).find(
      (preset) => String(preset?.name ?? "").trim().toLowerCase() === target,
    );
    if (!match) {
      throw new Error(`Preset not found: ${presetName}`);
    }
    return JSON.stringify(match);
  }

  async validateProperties(moduleSlug: string, properties: Properties): Promise<string> {
    const schema = JSON.parse(await this.getModuleDetails(moduleSlug)) as {
      definitions?: Array<{ key: string; type?: string; mandatory?: boolean }>;
    };
    const safe = properties ?? {};
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];
    const knownKeys = new Set<string>();

    for (const definition of schema.definitions ?? []) {
      const key = definition.key;
      knownKeys.add(key);
      const type = definition.type ?? "STRING";
      const mandatory = !!definition.mandatory;
      if (!Object.prototype.hasOwnProperty.call(safe, key)) {
        if (mandatory) {
          errors.push({ key, issue: `missing mandatory property (type ${type})` });
        }
        continue;
      }
      const issue = checkType(type, safe[key]);
      if (issue) {
        errors.push({ key, issue });
      }
    }

    for (const key of Object.keys(safe)) {
      if (!knownKeys.has(key)) {
        warnings.push({ key, issue: "unknown property — not declared in module schema" });
      }
    }

    return JSON.stringify({ slug: moduleSlug, valid: errors.length === 0, errors, warnings });
  }

  applyModule(moduleSlug: string, projectFolder: string, properties: Properties): Promise<string> {
    const body = {
      projectFolder,
      commit: false,
      parameters: properties ?? {},
    };
    return this.postJson(`/api/modules/${encodeURIComponent(moduleSlug)}/apply-patch`, body);
  }

  async createProject(projectFolder: string, properties: Properties): Promise<string> {
    await mkdir(projectFolder, { recursive: true });
    return this.applyModule("init", projectFolder, properties);
  }

  async applyModules(projectFolder: string, steps: ApplyStep[]): Promise<string> {
    if (!steps || steps.length === 0) {
      throw new Error("At least one module step is required");
    }

    const applied: AppliedEntry[] = [];
    let failure: FailureEntry | null = null;
    const remaining: string[] = [];

    for (const step of steps) {
      const slug = String(step.slug);
      const props =
        step.properties && typeof step.properties === "object" && !Array.isArray(step.properties)
          ? step.properties
          : {};
      if (failure) {
        remaining.push(slug);
        continue;
      }
      try {
        const response = await this.applyModule(slug, projectFolder, props);
        applied.push({ slug, response });
      } catch (error) {
        if (error instanceof HttpError) {
          failure = { slug, status: error.status, body: error.body };
        } else {
          failure = { slug, status: 0, body: (error as Error).message };
        }
      }
    }

    return JSON.stringify({
      projectFolder,
      appliedCount: applied.length,
      applied,
      failure,
      remaining,
    });
  }

  async applyPreset(presetName: string, projectFolder: string, properties: Properties): Promise<string> {
    const preset = JSON.parse(await this.getPresetDetails(presetName)) as {
      modules?: Array<{ slug?: string }>;
    };
    const safe = properties ?? {};
    const steps: ApplyStep[] = [];
    for (const module of preset.modules ?? []) {
      const slug = module?.slug;
      if (!slug) continue;
      steps.push({ slug, properties: safe });
    }
    if (steps.length === 0) {
      throw new Error(`Preset has no modules: ${presetName}`);
    }
    return this.applyModules(projectFolder, steps);
  }

  async getProjectStatus(projectFolder: string): Promise<string> {
    const url = `${this.baseUrl}/api/projects?path=${encodeURIComponent(projectFolder)}`;
    return this.withRetries(async () => {
      const response = await this.fetchWithTimeout(url, {
        method: "GET",
        headers: { accept: "application/json" },
      });
      const body = await response.text();
      if (!response.ok) {
        throw new HttpError(response.status, body, url);
      }
      return body;
    });
  }

  async searchModules(query: string, limit: number): Promise<string> {
    const tokens = tokenize(query);
    if (tokens.length === 0) {
      return JSON.stringify({ query: "", matches: [] });
    }
    const root = JSON.parse(await this.listModules()) as {
      categories?: Array<{
        name?: string;
        modules?: Array<{ slug?: string; description?: string; tags?: string[] }>;
      }>;
    };
    const matches: Array<{
      slug: string;
      description: string;
      tags: string[];
      category: string;
      score: number;
    }> = [];
    for (const category of root.categories ?? []) {
      const categoryName = category.name ?? "";
      const categoryLower = categoryName.toLowerCase();
      for (const module of category.modules ?? []) {
        const slug = module.slug ?? "";
        const description = module.description ?? "";
        const tags = Array.isArray(module.tags) ? module.tags : [];
        const score = scoreModule(tokens, slug.toLowerCase(), description.toLowerCase(), tags, categoryLower);
        if (score > 0) {
          matches.push({ slug, description, tags, category: categoryName, score });
        }
      }
    }
    matches.sort((a, b) => b.score - a.score);
    const effectiveLimit = limit > 0 ? limit : 20;
    return JSON.stringify({ query, matches: matches.slice(0, effectiveLimit) });
  }

  async getModuleDependencies(moduleSlug: string): Promise<string> {
    const landscape = JSON.parse(await this.getText("/api/modules-landscape")) as LandscapeRoot;
    const modulesBySlug = new Map<string, LandscapeModule>();
    const featureMembers = new Map<string, string[]>();
    indexLandscape(landscape, modulesBySlug, featureMembers);

    const target = modulesBySlug.get(moduleSlug);
    if (!target) {
      throw new Error(`Module not found in seed4j landscape: ${moduleSlug}`);
    }

    const applicationOrder = new Set<string>();
    const featureChoices: Record<string, string[]> = {};
    collectDependencies(target, modulesBySlug, featureMembers, applicationOrder, featureChoices, new Set());

    return JSON.stringify({
      slug: moduleSlug,
      operation: target.operation ?? "",
      rank: target.rank ?? "",
      directDependencies: target.dependencies ?? [],
      applicationOrder: [...applicationOrder],
      featureChoices,
    });
  }

  private async getText(path: string): Promise<string> {
    const url = `${this.baseUrl}${path}`;
    return this.withRetries(async () => {
      const response = await this.fetchWithTimeout(url, {
        method: "GET",
        headers: { accept: "application/json" },
      });
      const body = await response.text();
      if (!response.ok) {
        throw new HttpError(response.status, body, url);
      }
      return body;
    });
  }

  private async withRetries<T>(operation: () => Promise<T>): Promise<T> {
    let attempt = 0;
    let lastError: unknown;
    while (attempt <= this.retries) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (attempt === this.retries || !isRetryableGetError(error)) {
          throw error;
        }
        const exponent = Math.min(attempt, 10);
        const delay = Math.min(this.retryBaseDelayMs * 2 ** exponent, this.retryMaxDelayMs);
        await this.sleep(delay);
        attempt += 1;
      }
    }
    throw lastError;
  }

  private async postJson(path: string, payload: unknown): Promise<string> {
    const url = `${this.baseUrl}${path}`;
    const response = await this.fetchWithTimeout(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.text();
    if (!response.ok) {
      throw new HttpError(response.status, body, url);
    }
    return body;
  }

  private fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const method = (init.method ?? "GET").toUpperCase();
    const timeoutMs = this.timeoutMs;
    const baseHeaders = (init.headers as Record<string, string> | undefined) ?? {};
    const headers: Record<string, string> = this.authHeader
      ? { ...baseHeaders, Authorization: this.authHeader }
      : baseHeaders;
    return new Promise<Response>((resolve, reject) => {
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
        reject(new TimeoutError(url, method, timeoutMs));
      }, timeoutMs);
      this.fetcher(url, { ...init, headers, signal: controller.signal })
        .then((response) => {
          clearTimeout(timer);
          resolve(response);
        })
        .catch((error: unknown) => {
          clearTimeout(timer);
          if (controller.signal.aborted) {
            reject(new TimeoutError(url, method, timeoutMs));
            return;
          }
          reject(error as Error);
        });
    });
  }
}

function isRetryableGetError(error: unknown): boolean {
  if (error instanceof TimeoutError) return true;
  if (error instanceof HttpError) return error.status >= 500;
  return error instanceof Error;
}

function checkType(type: string, value: unknown): string | null {
  if (value === null || value === undefined) {
    return "value is null";
  }
  switch (type) {
    case "STRING":
      return typeof value === "string" ? null : `expected STRING, got ${typeName(value)}`;
    case "INTEGER":
      return isInteger(value) ? null : `expected INTEGER, got ${typeName(value)} (${String(value)})`;
    case "BOOLEAN":
      return typeof value === "boolean" ? null : `expected BOOLEAN, got ${typeName(value)}`;
    default:
      return null;
  }
}

function isInteger(value: unknown): boolean {
  if (typeof value === "number") {
    return Number.isInteger(value);
  }
  if (typeof value === "string") {
    return /^-?\d+$/.test(value.trim());
  }
  return false;
}

function typeName(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "Array";
  return typeof value;
}

function tokenize(query: string | null | undefined): string[] {
  if (!query || !query.trim()) return [];
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

function scoreModule(
  tokens: string[],
  slugLower: string,
  descriptionLower: string,
  tags: string[],
  categoryLower: string,
): number {
  let score = 0;
  for (const token of tokens) {
    if (slugLower.includes(token)) score += 3;
    if (descriptionLower.includes(token)) score += 2;
    for (const tag of tags) {
      if (tag.toLowerCase().includes(token)) score += 1;
    }
    if (categoryLower.includes(token)) score += 1;
  }
  return score;
}

interface LandscapeDependency {
  type?: string;
  slug?: string;
}

interface LandscapeModule {
  type?: string;
  slug?: string;
  operation?: string;
  rank?: string;
  dependencies?: LandscapeDependency[];
  modules?: LandscapeModule[];
}

interface LandscapeLevel {
  elements?: LandscapeModule[];
}

interface LandscapeRoot {
  levels?: LandscapeLevel[];
}

function indexLandscape(
  landscape: LandscapeRoot,
  modulesBySlug: Map<string, LandscapeModule>,
  featureMembers: Map<string, string[]>,
): void {
  for (const level of landscape.levels ?? []) {
    for (const element of level.elements ?? []) {
      if (element.type === "MODULE" && element.slug) {
        modulesBySlug.set(element.slug, element);
      } else if (element.type === "FEATURE" && element.slug) {
        const members: string[] = [];
        for (const member of element.modules ?? []) {
          if (member.slug) {
            modulesBySlug.set(member.slug, member);
            members.push(member.slug);
          }
        }
        featureMembers.set(element.slug, members);
      }
    }
  }
}

function collectDependencies(
  module: LandscapeModule,
  modulesBySlug: Map<string, LandscapeModule>,
  featureMembers: Map<string, string[]>,
  applicationOrder: Set<string>,
  featureChoices: Record<string, string[]>,
  visited: Set<string>,
): void {
  for (const dependency of module.dependencies ?? []) {
    if (dependency.type === "MODULE" && dependency.slug) {
      const slug = dependency.slug;
      if (visited.has(slug)) continue;
      visited.add(slug);
      const dependencyModule = modulesBySlug.get(slug);
      if (dependencyModule) {
        collectDependencies(
          dependencyModule,
          modulesBySlug,
          featureMembers,
          applicationOrder,
          featureChoices,
          visited,
        );
      }
      applicationOrder.add(slug);
    } else if (dependency.type === "FEATURE" && dependency.slug) {
      if (!(dependency.slug in featureChoices)) {
        featureChoices[dependency.slug] = featureMembers.get(dependency.slug) ?? [];
      }
    }
  }
}

