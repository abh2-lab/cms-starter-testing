-- Functional index supporting the public archive listing's
-- `ORDER BY COALESCE(publish_at, published_at) DESC, id DESC` clause.
-- Without it the planner falls back to Sort over the filtered set, which
-- is fine on small tenants but degrades on large ones. CONCURRENTLY is
-- avoided here because the migration runs in a transaction; the table
-- size at install time is trivial.
CREATE INDEX IF NOT EXISTS "content_tenant_status_visible_idx"
  ON "content" ("tenant_id", "status", COALESCE("publish_at", "published_at") DESC);
