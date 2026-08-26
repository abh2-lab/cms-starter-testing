CREATE TYPE "public"."page_type" AS ENUM('static', 'dynamic');--> statement-breakpoint
CREATE TABLE "page_revisions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"page_id" uuid NOT NULL,
	"tenant_id" uuid,
	"snapshot" jsonb NOT NULL,
	"changed_by" uuid,
	"change_summary" text,
	"revision_number" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page_status_transitions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"page_id" uuid NOT NULL,
	"from_status" "content_status",
	"to_status" "content_status" NOT NULL,
	"changed_by" uuid,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"type" "page_type" NOT NULL,
	"status" "content_status" DEFAULT 'draft' NOT NULL,
	"html" text,
	"css" text,
	"template_key" text,
	"blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"seo" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"translation_group_id" uuid,
	"system_managed" boolean DEFAULT false NOT NULL,
	"author_id" uuid,
	"published_by" uuid,
	"publish_at" timestamp with time zone,
	"unpublish_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pages_tenant_slug_uniq" UNIQUE NULLS NOT DISTINCT("tenant_id","slug")
);
--> statement-breakpoint
ALTER TABLE "page_revisions" ADD CONSTRAINT "page_revisions_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_revisions" ADD CONSTRAINT "page_revisions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_revisions" ADD CONSTRAINT "page_revisions_changed_by_admin_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_status_transitions" ADD CONSTRAINT "page_status_transitions_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_status_transitions" ADD CONSTRAINT "page_status_transitions_changed_by_admin_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_author_id_admin_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_published_by_admin_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "page_revisions_page_revision_uniq" ON "page_revisions" USING btree ("page_id","revision_number");--> statement-breakpoint
CREATE INDEX "page_status_transitions_page_idx" ON "page_status_transitions" USING btree ("page_id","created_at");--> statement-breakpoint
CREATE INDEX "pages_tenant_status_publish_idx" ON "pages" USING btree ("tenant_id","status","publish_at");--> statement-breakpoint
CREATE INDEX "pages_tenant_type_status_idx" ON "pages" USING btree ("tenant_id","type","status");--> statement-breakpoint
CREATE INDEX "pages_author_idx" ON "pages" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "pages_translation_group_idx" ON "pages" USING btree ("translation_group_id") WHERE translation_group_id IS NOT NULL;