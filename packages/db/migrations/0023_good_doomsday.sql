CREATE TABLE "theme_override_revisions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"override_id" uuid NOT NULL,
	"tenant_id" uuid,
	"snapshot" jsonb NOT NULL,
	"changed_by" uuid,
	"change_summary" text,
	"revision_number" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "theme_overrides" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"template_key" text NOT NULL,
	"draft_blocks" jsonb,
	"published_blocks" jsonb,
	"base_version" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid,
	"published_by" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "theme_overrides_tenant_key_uniq" UNIQUE("tenant_id","template_key")
);
--> statement-breakpoint
ALTER TABLE "theme_override_revisions" ADD CONSTRAINT "theme_override_revisions_override_id_theme_overrides_id_fk" FOREIGN KEY ("override_id") REFERENCES "public"."theme_overrides"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "theme_override_revisions" ADD CONSTRAINT "theme_override_revisions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "theme_override_revisions" ADD CONSTRAINT "theme_override_revisions_changed_by_admin_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "theme_overrides" ADD CONSTRAINT "theme_overrides_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "theme_overrides" ADD CONSTRAINT "theme_overrides_updated_by_admin_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "theme_overrides" ADD CONSTRAINT "theme_overrides_published_by_admin_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "theme_override_revisions_override_revision_uniq" ON "theme_override_revisions" USING btree ("override_id","revision_number");--> statement-breakpoint
CREATE INDEX "theme_overrides_tenant_kind_idx" ON "theme_overrides" USING btree ("tenant_id","kind");