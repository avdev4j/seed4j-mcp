import {
  DEFAULT_RETRIES,
  DEFAULT_TIMEOUT_MS,
  type Seed4jClientOptions,
} from "./client.js";

export const DEFAULT_BASE_URL = "http://localhost:1339";

export interface LoadedConfig {
  baseUrl: string;
  clientOptions: Seed4jClientOptions;
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

  return { baseUrl, clientOptions, warnings };
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
