CREATE TABLE "page_templates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"block_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"author_id" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_templates_tenant_key_uniq" UNIQUE NULLS NOT DISTINCT("tenant_id","key")
);
--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "layout_template" text;--> statement-breakpoint
-- Backfill: existing static rows get the default layout so the Nuxt
-- resolver's null branch stays a dead-code safety net rather than a hot
-- path. Dynamic rows stay NULL — the column is static-only.
UPDATE "pages" SET "layout_template" = 'default' WHERE "type" = 'static' AND "layout_template" IS NULL;--> statement-breakpoint
ALTER TABLE "page_templates" ADD CONSTRAINT "page_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_templates" ADD CONSTRAINT "page_templates_author_id_admin_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_templates_tenant_updated_idx" ON "page_templates" USING btree ("tenant_id","updated_at");