import { createWriteStream, type WriteStream } from "node:fs";

export type LogLevel = "debug" | "info" | "warn";

export type LogFields = Record<string, unknown>;

export interface Logger {
  log(level: LogLevel, event: string, fields?: LogFields): void;
  close(): void;
}

const NOOP_LOGGER: Logger = Object.freeze({
  log: () => undefined,
  close: () => undefined,
});

export function noopLogger(): Logger {
  return NOOP_LOGGER;
}

export interface CreateLoggerOptions {
  now?: () => number;
}

export function createLogger(
  filePath: string | undefined,
  options: CreateLoggerOptions = {},
): Logger {
  const target = filePath?.trim();
  if (!target) return NOOP_LOGGER;

  let stream: WriteStream;
  try {
    stream = createWriteStream(target, { flags: "a" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `seed4j-mcp: could not open log file ${target}: ${message}\n`,
    );
    return NOOP_LOGGER;
  }

  stream.on("error", (error) => {
    process.stderr.write(
      `seed4j-mcp: log file ${target} write error: ${error.message}\n`,
    );
  });

  const now = options.now ?? Date.now;
  return {
    log(level, event, fields = {}) {
      const line = JSON.stringify({
        timestamp: new Date(now()).toISOString(),
        level,
        event,
        ...fields,
      });
      stream.write(`${line}\n`);
    },
    close() {
      stream.end();
    },
  };
}
