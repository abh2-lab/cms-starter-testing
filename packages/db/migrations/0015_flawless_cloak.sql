ALTER TABLE "pages" ADD COLUMN "layout_template" text;--> statement-breakpoint
-- Backfill: existing static rows pick up the default layout so the
-- admin select always renders a chosen option (no "— choose —" trap)
-- and a future Nuxt-side switch on this field stays a hot path.
UPDATE "pages" SET "layout_template" = 'default' WHERE "type" = 'static' AND "layout_template" IS NULL;