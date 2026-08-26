// Deterministic, idempotent insertion into a hand-maintained registry file via
// `// <gen:NAME> … // </gen:NAME>` sentinel regions (added once to registry.ts,
// index.ts and the theme's useBlockRegistry.ts). This is what lets gen edit the
// "static map (not generated) on purpose" the theme deliberately keeps by hand —
// without ever duplicating or clobbering a hand-written entry.

function regionBounds(
  content: string,
  name: string,
): { openEnd: number; closeStart: number } {
  const open = new RegExp(`^[^\\n]*// <gen:${name}>[^\\n]*$`, 'm').exec(content);
  const close = new RegExp(`^[^\\n]*// </gen:${name}>[^\\n]*$`, 'm').exec(content);
  if (!open || !close) {
    throw new Error(
      `theme-kit: anchor region <gen:${name}> not found (expected "// <gen:${name}>" … "// </gen:${name}>")`,
    );
  }
  const openEnd = open.index + open[0].length;
  if (close.index < openEnd) {
    throw new Error(`theme-kit: malformed anchor region <gen:${name}> (close before open)`);
  }
  return { openEnd, closeStart: close.index };
}

// Insert `newLine` just above the closing marker. Idempotent: any existing line
// in the region matching `identity` is removed first, so re-running gen for the
// same key updates in place rather than duplicating.
export function upsertInAnchorRegion(
  content: string,
  name: string,
  identity: RegExp,
  newLine: string,
): string {
  const { openEnd, closeStart } = regionBounds(content, name);
  const before = content.slice(0, openEnd);
  const region = content.slice(openEnd, closeStart);
  const after = content.slice(closeStart);

  const kept = region
    .split('\n')
    .filter((line) => line.trim().length > 0 && !identity.test(line));

  const newRegion = ['', ...kept, newLine, ''].join('\n');
  return before + newRegion + after;
}

// Whether a region already contains a line matching `identity`.
export function regionHasLine(content: string, name: string, identity: RegExp): boolean {
  const { openEnd, closeStart } = regionBounds(content, name);
  return content
    .slice(openEnd, closeStart)
    .split('\n')
    .some((line) => identity.test(line));
}
