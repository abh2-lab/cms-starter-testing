export interface TourStep {
  /** CSS selector to highlight. Used as a `data-tour-id` attribute on the
   *  target element in AppLayout.vue sidebar items.
   */
  target: string;
  title: string;
  body: string;
}

/** Welcome tour: one step per top-level sidebar section. Plain language —
 *  the audience is a publisher who may not be technical. Steps whose target
 *  element doesn't exist (role-hidden sections) are filtered at start() time.
 */
export const dashboardTourSteps: TourStep[] = [
  {
    target: '[data-tour-id="nav-home"]',
    title: 'This is your dashboard',
    body: "Your home base. See recent posts, what your team is doing, and quick links to everything. Come back here whenever you want a bird's-eye view.",
  },
  {
    target: '[data-tour-id="nav-content"]',
    title: 'Write and edit your posts here',
    body: 'Every article and page you write lives under Content. Click "All Content" to see everything, or pick a specific type from the list.',
  },
  {
    target: '[data-tour-id="nav-media"]',
    title: 'Photos, videos, and files',
    body: 'Upload pictures once, then drop them into any post. Think of it as your photo album.',
  },
  {
    target: '[data-tour-id="nav-taxonomy"]',
    title: 'Group your posts by topic',
    body: 'Categories and tags help readers find related stories — like Sports, Politics, or Local.',
  },
  {
    target: '[data-tour-id="nav-structure"]',
    title: 'The shape of your site',
    body: "Decide what kinds of content your site has (articles, recipes, events…), build the menus readers click, and set up redirects when an old URL needs to point somewhere new.",
  },
  {
    target: '[data-tour-id="nav-settings"]',
    title: 'Site-wide controls',
    body: 'Your site name, email setup, who can log in, and the keys you give other apps. Change these once and forget them.',
  },
  {
    target: '[data-tour-id="nav-insights"]',
    title: "See what's happening behind the scenes",
    body: 'A log of recent actions — useful when you want to know who did what, or when a background job ran.',
  },
];
