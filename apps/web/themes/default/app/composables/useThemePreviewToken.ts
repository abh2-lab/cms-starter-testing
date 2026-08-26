// Theme-preview token (theme engine v2.0). The structure editor's iframe
// opens the real public site with ?theme_preview=<HMAC token>; every
// template-composed fetch on the page (content, archive views, parts)
// forwards it so the API resolves DRAFT overrides for the whole render. The
// token also lands in each useAsyncData key, so a preview session and a
// public visit never share a payload entry.
export function useThemePreviewToken() {
  const route = useRoute();
  return computed<string | null>(() => {
    const raw = route.query['theme_preview'];
    return typeof raw === 'string' && raw.length > 0 ? raw : null;
  });
}
