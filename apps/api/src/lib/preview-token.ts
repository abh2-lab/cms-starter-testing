import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '@cms/config';

// Short-lived HMAC tokens for the in-editor Preview button. Stateless on
// purpose — verifying a token costs one HMAC, no DB lookup — and scoped to
// a single content id so a leaked token can't be reused to peek at sibling
// drafts. Rotate PREVIEW_TOKEN_SECRET to invalidate every outstanding link.
//
// Wire format: `${base64url(payloadJSON)}.${base64url(hmacSha256(payload))}`
// payload = { cid: <uuid>, exp: <unix-seconds> }

const DEFAULT_TTL_SECONDS = 10 * 60;

interface PreviewTokenPayload {
  cid: string;
  exp: number;
}

function toBase64Url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function fromBase64Url(str: string): Buffer {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4;
  const full = pad === 0 ? padded : padded + '='.repeat(4 - pad);
  return Buffer.from(full, 'base64');
}

function sign(payload: string): string {
  const mac = createHmac('sha256', env.PREVIEW_TOKEN_SECRET)
    .update(payload)
    .digest();
  return toBase64Url(mac);
}

export interface GeneratedPreviewToken {
  token: string;
  expiresAt: Date;
}

export function generatePreviewToken(
  contentId: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): GeneratedPreviewToken {
  const expSeconds = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload: PreviewTokenPayload = { cid: contentId, exp: expSeconds };
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = toBase64Url(Buffer.from(payloadJson, 'utf8'));
  const sig = sign(payloadB64);
  return {
    token: `${payloadB64}.${sig}`,
    expiresAt: new Date(expSeconds * 1000),
  };
}

// Verify the signature + parse the payload JSON. Shared by both token
// flavours; each verifier then checks its own payload shape + expiry.
function verifySignedPayload(token: string): unknown {
  if (typeof token !== 'string' || token.length === 0) return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;
  const payloadB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);

  const expectedSig = sign(payloadB64);
  // Constant-time compare; bail on length mismatch first (timingSafeEqual
  // throws on different-length buffers).
  if (expectedSig.length !== sigB64.length) return null;
  const a = Buffer.from(expectedSig);
  const b = Buffer.from(sigB64);
  if (!timingSafeEqual(a, b)) return null;

  try {
    return JSON.parse(fromBase64Url(payloadB64).toString('utf8'));
  } catch {
    return null;
  }
}

export interface VerifiedPreviewToken {
  contentId: string;
}

export function verifyPreviewToken(
  token: string,
): VerifiedPreviewToken | null {
  const parsed = verifySignedPayload(token);
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    typeof (parsed as { cid?: unknown }).cid !== 'string' ||
    typeof (parsed as { exp?: unknown }).exp !== 'number'
  ) {
    return null;
  }
  const { cid, exp } = parsed as PreviewTokenPayload;
  if (exp * 1000 <= Date.now()) return null;
  return { contentId: cid };
}

// ─── Theme-preview tokens (structure-editor drafts, theme engine v2.0) ────
//
// Same wire format + secret, different payload: { scope: 'theme', exp }.
// Deliberately NOT scoped to one template: the editor's iframe walks the
// REAL public site, and every template-composed route the page touches
// (content + views + parts) must see the draft overrides during one preview
// session. Mutual rejection with content tokens is structural — this
// verifier requires scope === 'theme' (content payloads lack it); the
// content verifier requires a string `cid` (theme payloads lack it).

interface ThemePreviewTokenPayload {
  scope: 'theme';
  exp: number;
}

export function generateThemePreviewToken(
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): GeneratedPreviewToken {
  const expSeconds = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload: ThemePreviewTokenPayload = { scope: 'theme', exp: expSeconds };
  const payloadB64 = toBase64Url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = sign(payloadB64);
  return {
    token: `${payloadB64}.${sig}`,
    expiresAt: new Date(expSeconds * 1000),
  };
}

export function verifyThemePreviewToken(token: string): boolean {
  const parsed = verifySignedPayload(token);
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    (parsed as { scope?: unknown }).scope !== 'theme' ||
    typeof (parsed as { exp?: unknown }).exp !== 'number'
  ) {
    return false;
  }
  return (parsed as ThemePreviewTokenPayload).exp * 1000 > Date.now();
}
