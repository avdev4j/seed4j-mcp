import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface CapturedRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}

export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  body: string,
) => void | Promise<void>;

export interface MockServer {
  baseUrl: string;
  requests: CapturedRequest[];
  setRoute(method: string, path: string, handler: RouteHandler): void;
  close(): Promise<void>;
}

export async function startServer(): Promise<MockServer> {
  const requests: CapturedRequest[] = [];
  const routes = new Map<string, RouteHandler>();

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", async () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const method = (req.method ?? "GET").toUpperCase();
      const url = req.url ?? "/";
      const path = url.split("?")[0] ?? "/";
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(req.headers)) {
        if (Array.isArray(value)) headers[key.toLowerCase()] = value.join(", ");
        else if (value !== undefined) headers[key.toLowerCase()] = value;
      }
      requests.push({ method, path: url, headers, body });

      const key = `${method} ${path}`;
      const handler = routes.get(key);
      if (!handler) {
        res.statusCode = 404;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: "no route registered", method, path }));
        return;
      }
      try {
        await handler(req, res, body);
      } catch (error) {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json");
        const message = error instanceof Error ? error.message : String(error);
        res.end(JSON.stringify({ error: "handler threw", message }));
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, "127.0.0.1");
  });
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    requests,
    setRoute(method, path, handler) {
      routes.set(`${method.toUpperCase()} ${path}`, handler);
    },
    close(): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}

export function jsonRoute(body: string, status = 200): RouteHandler {
  return (_req, res) => {
    res.statusCode = status;
    res.setHeader("content-type", "application/json");
    res.end(body);
  };
}

export function delayedRoute(body: string, delayMs: number, status = 200): RouteHandler {
  return (_req, res) => {
    setTimeout(() => {
      res.statusCode = status;
      res.setHeader("content-type", "application/json");
      res.end(body);
    }, delayMs);
  };
}

export function sequenceRoute(...handlers: RouteHandler[]): RouteHandler {
  let i = 0;
  return async (req, res, body) => {
    const handler = handlers[Math.min(i, handlers.length - 1)];
    i += 1;
    await handler!(req, res, body);
  };
}
