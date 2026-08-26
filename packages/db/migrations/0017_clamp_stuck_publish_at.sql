-- One-shot backfill for rows that are status='published' but still carry a
-- future publish_at — the broken state the previous transitions handler
-- left behind whenever an author clicked Publish on a row whose editor
-- still held a future Schedule-publish timestamp (e.g. seeded scheduled
-- posts, or rows where the author tweaked the date before pressing
-- Publish instead of Schedule). The public archive + detail endpoints
-- filter on `publish_at IS NULL OR publish_at <= NOW()`, so these rows
-- appear `published` in admin but 404 on the site. Clamping publish_at
-- to NOW() restores visibility immediately; published_at is left alone
-- so the historical "when did this go live" timestamp stays accurate.
-- Idempotent: only touches rows that match the bad state.
UPDATE "content"
   SET "publish_at" = NOW()
 WHERE "status" = 'published'
   AND "publish_at" IS NOT NULL
   AND "publish_at" > NOW();
