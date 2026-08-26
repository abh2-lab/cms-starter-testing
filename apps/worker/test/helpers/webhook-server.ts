import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface CapturedRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

export interface TestWebhookServer {
  url: string;
  /** Returns the next captured request — waits if none has arrived yet. */
  next: (timeoutMs?: number) => Promise<CapturedRequest>;
  close: () => Promise<void>;
}

/**
 * Tiny in-test HTTP server. Binds to port 0 so the OS picks a free port,
 * captures every request, and responds with the configured status. Used by
 * the webhook-deliver integration test to assert on signature + body shape.
 */
export async function startWebhookServer(
  opts: { status?: number } = {},
): Promise<TestWebhookServer> {
  const status = opts.status ?? 200;
  const queue: CapturedRequest[] = [];
  const waiters: Array<(c: CapturedRequest) => void> = [];

  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8');
    });
    req.on('end', () => {
      const captured: CapturedRequest = {
        method: req.method ?? 'POST',
        url: req.url ?? '/',
        headers: req.headers,
        body,
      };
      const waiter = waiters.shift();
      if (waiter) waiter(captured);
      else queue.push(captured);
      res.writeHead(status, { 'Content-Type': 'text/plain' });
      res.end(status >= 200 && status < 300 ? 'ok' : 'fail');
    });
  });

  await new Promise<void>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve()),
  );
  const port = (server.address() as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${port}/hook`,
    next: async (timeoutMs = 10_000) => {
      const pending = queue.shift();
      if (pending) return pending;
      return new Promise<CapturedRequest>((resolve, reject) => {
        const timer = setTimeout(() => {
          const idx = waiters.indexOf(resolveFn);
          if (idx >= 0) waiters.splice(idx, 1);
          reject(
            new Error(
              `no webhook request received within ${timeoutMs}ms`,
            ),
          );
        }, timeoutMs);
        const resolveFn = (c: CapturedRequest): void => {
          clearTimeout(timer);
          resolve(c);
        };
        waiters.push(resolveFn);
      });
    },
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
