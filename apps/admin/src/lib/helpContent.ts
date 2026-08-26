// Help content + the admin navigation map now live in the shared
// @cms/admin-guide package, so the SAME operator help feeds both this help
// drawer and the in-admin AI assistant (which runs server-side in apps/api).
// Edit the content in packages/admin-guide/src/help-content.ts. This re-export
// keeps existing `@/lib/helpContent` imports (HelpDrawer.vue, AiAssistant.vue)
// working unchanged.
export * from '@cms/admin-guide';
