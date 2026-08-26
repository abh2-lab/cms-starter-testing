// Loads the in-repo developer documentation bundled under src/docs/*.md.
//
// The docs are authored as plain Markdown files and compiled into the admin
// bundle at build time via Vite's import.meta.glob (?raw → file contents as a
// string). There is intentionally NO API call and NO database: docs ship with
// the app, so editing a doc = editing a committed .md file. The Documentation
// page renders the result through MarkdownRenderer.vue.
//
// Optional frontmatter controls ordering + title:
//
//   ---
//   title: Getting started
//   order: 1
//   ---
//
// Without frontmatter we fall back to a numeric filename prefix (e.g.
// `01-getting-started.md`) for order and a title-cased slug for the label.

export interface DocPage {
  /** Stable slug used in the ?doc= query — filename minus numeric prefix + ext. */
  slug: string;
  /** Human label for the sidebar. */
  title: string;
  /** Sort key (frontmatter `order`, else filename numeric prefix, else 999). */
  order: number;
  /** Markdown body with the frontmatter block stripped. */
  body: string;
}

// Eager raw glob — every .md file becomes a string at build time. The
// explicit <string> generic (not an `as` cast) is what both vue-tsc and
// ESLint's project service agree on: their vite/client programs infer
// different types for the query:'?raw' shorthand.
const modules = import.meta.glob<string>('../docs/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});

interface Frontmatter {
  data: Record<string, string>;
  body: string;
}

// Minimal YAML-ish frontmatter parser: a leading `---` block of `key: value`
// lines. Deliberately tiny — we don't want a gray-matter dependency for two
// keys. Anything we don't recognise is ignored.
function parseFrontmatter(raw: string): Frontmatter {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!match) return { data: {}, body: raw };
  const data: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    if (!key) continue;
    const value = line
      .slice(idx + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    data[key] = value;
  }
  return { data, body: raw.slice(match[0].length) };
}

function titleCase(slug: string): string {
  return slug
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function buildDoc(path: string, raw: string): DocPage {
  const file = (path.split('/').pop() ?? path).replace(/\.md$/i, '');
  const prefix = /^(\d+)[-_]?(.*)$/.exec(file);
  const { data, body } = parseFrontmatter(raw);
  const slug = (prefix?.[2] || file).trim() || file;
  const order = data['order']
    ? Number(data['order'])
    : prefix
      ? Number(prefix[1])
      : 999;
  const title = data['title']?.trim() || titleCase(slug);
  return { slug, title, order, body };
}

let cache: DocPage[] | null = null;

/** All bundled docs, sorted by order then title. Memoised. */
export function getDocs(): DocPage[] {
  if (cache) return cache;
  cache = Object.entries(modules)
    .map(([path, raw]) => buildDoc(path, raw))
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
  return cache;
}
