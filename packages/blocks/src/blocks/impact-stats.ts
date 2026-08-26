import type { Block } from '../types.js';

// ImpactStats — purely admin-data-driven: the loader does nothing; the
// `stats` field IS the data. Defaults are neutral placeholders so a fresh
// seed of the home page renders something useful even before the admin
// tweaks the numbers.

interface ImpactStatsFields {
  title?: string;
  eyebrow?: string;
  stats?: Array<{ label: string; value: string }>;
}
export const impactStats: Block<ImpactStatsFields, Record<string, unknown>> = {
  meta: {
    key: 'impact-stats',
    label: 'Impact Stats',
    category: 'metrics',
    description: 'A row of headline metrics (label + big number).',
    icon: 'grid',
    fields: [
      { key: 'eyebrow', label: 'Eyebrow', type: 'short_text', default: 'By the numbers' },
      {
        key: 'title',
        label: 'Section title',
        type: 'short_text',
        default: 'A quick snapshot',
      },
      {
        key: 'stats',
        label: 'Stats',
        type: 'kv_list',
        helpText:
          'Each entry is a {label, value} pair. Value is rendered as the large number.',
      },
    ],
    options: [],
  },
  // Sync internally — no DB or external call — but the Block.load contract
  // is async, so the body is wrapped in Promise.resolve(). Avoids the
  // `require-await` lint without diverging from the shared interface.
  load(_ctx, { fields }) {
    const stats = Array.isArray(fields.stats) ? fields.stats : [];
    // Filter out any malformed rows so the renderer doesn't crash on an
    // accidental empty row in the admin editor.
    const cleaned = stats.filter(
      (s): s is { label: string; value: string } =>
        typeof s === 'object' &&
        s !== null &&
        typeof (s as { label?: unknown }).label === 'string' &&
        typeof (s as { value?: unknown }).value === 'string',
    );
    return Promise.resolve({
      title: fields.title ?? 'A quick snapshot',
      eyebrow: fields.eyebrow ?? 'By the numbers',
      stats: cleaned,
    });
  },
};
