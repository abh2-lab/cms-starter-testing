// Cursor helpers for keyset pagination over (name, id) tuples — used by
// list endpoints that want to preserve alphabetical ordering across pages.
// The on-the-wire cursor is opaque base64url JSON; callers must not parse it.

export type NameIdCursor = { name: string; id: string };

export function encodeNameIdCursor(c: NameIdCursor): string {
  return Buffer.from(JSON.stringify({ n: c.name, i: c.id }), 'utf8').toString(
    'base64url',
  );
}

export function decodeNameIdCursor(s: string): NameIdCursor | null {
  try {
    const json = Buffer.from(s, 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(json);
    if (
      parsed &&
      typeof parsed === 'object' &&
      'n' in parsed &&
      'i' in parsed &&
      typeof (parsed as { n: unknown }).n === 'string' &&
      typeof (parsed as { i: unknown }).i === 'string'
    ) {
      return {
        name: (parsed as { n: string }).n,
        id: (parsed as { i: string }).i,
      };
    }
    return null;
  } catch {
    return null;
  }
}
