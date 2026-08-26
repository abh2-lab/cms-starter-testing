CREATE TABLE "monitoring_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid,
	"sentry_dsn_encrypted" "bytea",
	"environment" text,
	"release_tag" text,
	"traces_sample_rate" integer DEFAULT 0 NOT NULL,
	"capture_unhandled_errors" boolean DEFAULT true NOT NULL,
	"include_user_context" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monitoring_settings_tenant_id_uniq" UNIQUE NULLS NOT DISTINCT("tenant_id")
);
--> statement-breakpoint
ALTER TABLE "monitoring_settings" ADD CONSTRAINT "monitoring_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;