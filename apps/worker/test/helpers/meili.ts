import { CONTENT_INDEX_NAME, meili } from '@cms/search';

export async function clearContentIndex(): Promise<void> {
  try {
    // EnqueuedTaskPromise has a convenience waitTask() that resolves once
    // Meili has processed the delete — needed so subsequent searches don't
    // race with the index update.
    await meili.index(CONTENT_INDEX_NAME).deleteAllDocuments().waitTask();
  } catch {
    // index may be empty / not yet created
  }
}

// Returns unknown — null is a valid unknown, so the explicit union was
// redundant (typescript-eslint/no-redundant-type-constituents).
export async function getContentDoc(id: string): Promise<unknown> {
  try {
    return await meili.index(CONTENT_INDEX_NAME).getDocument(id);
  } catch {
    return null;
  }
}
