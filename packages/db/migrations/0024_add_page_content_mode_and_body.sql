ALTER TABLE "pages" ADD COLUMN "content_mode" text DEFAULT 'raw' NOT NULL;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "body" jsonb;