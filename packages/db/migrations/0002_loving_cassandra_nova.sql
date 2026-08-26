CREATE TYPE "public"."content_status" AS ENUM('draft', 'in_review', 'approved', 'scheduled', 'published', 'archived');--> statement-breakpoint
CREATE TABLE "content_types" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"icon" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"field_definitions" jsonb DEFAULT '{"fields":[]}'::jsonb NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_types_tenant_slug_uniq" UNIQUE NULLS NOT DISTINCT("tenant_id","slug")
);
--> statement-breakpoint
CREATE TABLE "content" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid,
	"content_type_id" uuid NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"status" "content_status" DEFAULT 'draft' NOT NULL,
	"author_id" uuid,
	"published_by" uuid,
	"publish_at" timestamp with time zone,
	"unpublish_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"featured" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"seo_title" text,
	"seo_description" text,
	"og_image_url" text,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"translation_group_id" uuid,
	"view_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_tenant_type_slug_uniq" UNIQUE NULLS NOT DISTINCT("tenant_id","content_type_id","slug")
);
--> statement-breakpoint
CREATE TABLE "content_revisions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"content_id" uuid NOT NULL,
	"tenant_id" uuid,
	"snapshot" jsonb NOT NULL,
	"changed_by" uuid,
	"change_summary" text,
	"revision_number" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_status_transitions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"content_id" uuid NOT NULL,
	"from_status" "content_status",
	"to_status" "content_status" NOT NULL,
	"changed_by" uuid,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_view_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"content_id" uuid NOT NULL,
	"tenant_id" uuid,
	"viewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"public_user_id" uuid,
	"ip_hash" text,
	"referrer" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "content_taxonomy_terms" (
	"content_id" uuid NOT NULL,
	"term_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_taxonomy_terms_content_id_term_id_pk" PRIMARY KEY("content_id","term_id")
);
--> statement-breakpoint
CREATE TABLE "taxonomies" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"is_hierarchical" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "taxonomies_tenant_slug_uniq" UNIQUE NULLS NOT DISTINCT("tenant_id","slug")
);
--> statement-breakpoint
CREATE TABLE "taxonomy_terms" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid,
	"taxonomy_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"parent_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content_types" ADD CONSTRAINT "content_types_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content" ADD CONSTRAINT "content_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content" ADD CONSTRAINT "content_content_type_id_content_types_id_fk" FOREIGN KEY ("content_type_id") REFERENCES "public"."content_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content" ADD CONSTRAINT "content_author_id_admin_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content" ADD CONSTRAINT "content_published_by_admin_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_revisions" ADD CONSTRAINT "content_revisions_content_id_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_revisions" ADD CONSTRAINT "content_revisions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_revisions" ADD CONSTRAINT "content_revisions_changed_by_admin_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_status_transitions" ADD CONSTRAINT "content_status_transitions_content_id_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_status_transitions" ADD CONSTRAINT "content_status_transitions_changed_by_admin_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_view_events" ADD CONSTRAINT "content_view_events_content_id_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_view_events" ADD CONSTRAINT "content_view_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_taxonomy_terms" ADD CONSTRAINT "content_taxonomy_terms_content_id_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_taxonomy_terms" ADD CONSTRAINT "content_taxonomy_terms_term_id_taxonomy_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."taxonomy_terms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taxonomies" ADD CONSTRAINT "taxonomies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taxonomy_terms" ADD CONSTRAINT "taxonomy_terms_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taxonomy_terms" ADD CONSTRAINT "taxonomy_terms_taxonomy_id_taxonomies_id_fk" FOREIGN KEY ("taxonomy_id") REFERENCES "public"."taxonomies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taxonomy_terms" ADD CONSTRAINT "taxonomy_terms_parent_id_taxonomy_terms_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."taxonomy_terms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_types_tenant_idx" ON "content_types" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "content_tenant_status_publish_idx" ON "content" USING btree ("tenant_id","status","publish_at");--> statement-breakpoint
CREATE INDEX "content_tenant_type_status_idx" ON "content" USING btree ("tenant_id","content_type_id","status");--> statement-breakpoint
CREATE INDEX "content_translation_group_idx" ON "content" USING btree ("translation_group_id") WHERE translation_group_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "content_author_idx" ON "content" USING btree ("author_id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_revisions_content_revision_uniq" ON "content_revisions" USING btree ("content_id","revision_number");--> statement-breakpoint
CREATE INDEX "content_status_transitions_content_idx" ON "content_status_transitions" USING btree ("content_id","created_at");--> statement-breakpoint
CREATE INDEX "content_view_events_content_viewed_idx" ON "content_view_events" USING btree ("content_id","viewed_at");--> statement-breakpoint
CREATE INDEX "content_taxonomy_terms_term_idx" ON "content_taxonomy_terms" USING btree ("term_id");--> statement-breakpoint
CREATE INDEX "taxonomies_tenant_idx" ON "taxonomies" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "taxonomy_terms_taxonomy_slug_uniq" ON "taxonomy_terms" USING btree ("taxonomy_id","slug");--> statement-breakpoint
CREATE INDEX "taxonomy_terms_parent_idx" ON "taxonomy_terms" USING btree ("parent_id");--> statement-breakpoint
-- ====================================================================
-- updated_at triggers for tables introduced in this migration
-- (content_revisions, content_status_transitions, content_view_events,
--  content_taxonomy_terms are all append-only — no triggers.)
-- ====================================================================
CREATE TRIGGER set_updated_at_content_types
  BEFORE UPDATE ON content_types
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER set_updated_at_content
  BEFORE UPDATE ON content
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER set_updated_at_taxonomies
  BEFORE UPDATE ON taxonomies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER set_updated_at_taxonomy_terms
  BEFORE UPDATE ON taxonomy_terms
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();