import {
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_RETRIES,
  DEFAULT_TIMEOUT_MS,
  type Seed4jClientOptions,
} from "./client.js";

export const DEFAULT_BASE_URL = "http://localhost:1339";

export interface LoadedConfig {
  baseUrl: string;
  clientOptions: Seed4jClientOptions;
  logFile: string | undefined;
  warnings: string[];
}

export function loadConfig(env: NodeJS.ProcessEnv): LoadedConfig {
  const warnings: string[] = [];
  const clientOptions: Seed4jClientOptions = {};

  const baseUrl = env.SEED4J_BASE_URL?.trim() || DEFAULT_BASE_URL;

  const timeoutRaw = env.SEED4J_TIMEOUT_MS?.trim();
  if (timeoutRaw) {
    const parsed = parsePositiveInteger(timeoutRaw);
    if (parsed === null) {
      warnings.push(
        `ignoring SEED4J_TIMEOUT_MS="${timeoutRaw}": expected a positive integer (using default ${DEFAULT_TIMEOUT_MS})`,
      );
    } else {
      clientOptions.timeoutMs = parsed;
    }
  }

  const retriesRaw = env.SEED4J_RETRIES?.trim();
  if (retriesRaw) {
    const parsed = parseNonNegativeInteger(retriesRaw);
    if (parsed === null) {
      warnings.push(
        `ignoring SEED4J_RETRIES="${retriesRaw}": expected a non-negative integer (using default ${DEFAULT_RETRIES})`,
      );
    } else {
      clientOptions.retries = parsed;
    }
  }

  const cacheTtlRaw = env.SEED4J_CACHE_TTL_MS?.trim();
  if (cacheTtlRaw) {
    const parsed = parseNonNegativeInteger(cacheTtlRaw);
    if (parsed === null) {
      warnings.push(
        `ignoring SEED4J_CACHE_TTL_MS="${cacheTtlRaw}": expected a non-negative integer (using default ${DEFAULT_CACHE_TTL_MS})`,
      );
    } else {
      clientOptions.cacheTtlMs = parsed;
    }
  }

  const authHeader = env.SEED4J_AUTH_HEADER?.trim();
  const bearerToken = env.SEED4J_BEARER_TOKEN?.trim();
  if (authHeader) {
    clientOptions.authHeader = authHeader;
    if (bearerToken) {
      warnings.push(
        "both SEED4J_AUTH_HEADER and SEED4J_BEARER_TOKEN are set: SEED4J_AUTH_HEADER takes precedence",
      );
    }
  } else if (bearerToken) {
    clientOptions.authHeader = `Bearer ${bearerToken}`;
  }

  const logFile = env.SEED4J_LOG_FILE?.trim() || undefined;

  return { baseUrl, clientOptions, logFile, warnings };
}

function parsePositiveInteger(raw: string): number | null {
  if (!/^-?\d+$/.test(raw)) return null;
  const value = Number.parseInt(raw, 10);
  return value > 0 ? value : null;
}

function parseNonNegativeInteger(raw: string): number | null {
  if (!/^-?\d+$/.test(raw)) return null;
  const value = Number.parseInt(raw, 10);
  return value >= 0 ? value : null;
}
