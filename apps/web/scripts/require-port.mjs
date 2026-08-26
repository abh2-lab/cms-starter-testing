#!/usr/bin/env node
// Refuse to start the web dev server unless its own port is actually free.
//
// Nuxt resolves its dev port through get-port-please, which SILENTLY FALLS BACK
// when the requested port is busy — and its alternative range begins at 3000,
// which is the API's port. Because `turbo run dev` starts every package at
// once, the web server wins that race and the API then dies with EADDRINUSE:
//
//   [get-port] Unable to find an available port (tried 3001 ...). Using
//   alternative port 3000.
//   ERROR listen EADDRINUSE: address already in use 0.0.0.0:3000
//
// The failure is misleading twice over: the thing that breaks (the API) is not
// the thing that misbehaved (web), and the reported cause (3000 in use) is not
// the real one (3001 was in use). Binding the intended port up front turns a
// confusing cascade into one clear message about the port that is actually
// occupied.
//
// Usage: node scripts/require-port.mjs <port>   (exits non-zero if unavailable)

import net from 'node:net';

const port = Number(process.env['PORT'] || process.argv[2] || 3001);

/** Resolve to an error code if `host:port` cannot be bound, else null. */
function probe(host) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err) => resolve(err.code ?? 'EUNKNOWN'));
    server.once('listening', () => server.close(() => resolve(null)));
    server.listen(port, host);
  });
}

// Probe the wildcard AND both loopback stacks.
//
// All three are needed. "localhost" resolves to ::1 and/or 127.0.0.1 depending
// on the machine — this repo's own dev server binds ONLY [::1] — so a
// loopback-only check must cover both. And on Windows a bind to 127.0.0.1:P
// SUCCEEDS while another process holds the wildcard 0.0.0.0:P, so without the
// wildcard probe the most common squatter (a server bound to all interfaces,
// which is how the api binds) reads as "free". Found by pointing this script at
// port 3000 while the api was demonstrably serving on it and getting exit 0.
const failures = [];
for (const host of ['0.0.0.0', '127.0.0.1', '::1']) {
  const code = await probe(host);
  if (code && code !== 'EAFNOSUPPORT' && code !== 'EADDRNOTAVAIL') {
    failures.push(`${host}:${port} (${code})`);
  }
}

if (failures.length === 0) process.exit(0);

console.error('');
console.error(`  Port ${port} is not available: ${failures.join(', ')}`);
console.error('');
console.error('  The web dev server needs this exact port. Left to itself Nuxt');
console.error("  would quietly take the API's port (3000) instead, and the API");
console.error('  would be the thing that appears to fail.');
console.error('');
console.error('  Find the holder, then stop it:');
console.error(`    netstat -ano | grep ":${port}.*LISTENING"     # Windows`);
console.error('    taskkill //PID <pid> //F');
console.error(`    lsof -nP -iTCP:${port} -sTCP:LISTEN            # macOS / Linux`);
console.error('');
console.error(`  Or run this instance elsewhere:  PORT=3002 pnpm dev`);
console.error('');
process.exit(1);
