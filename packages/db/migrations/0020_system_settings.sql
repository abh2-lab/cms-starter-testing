CREATE TABLE "system_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid,
	"rate_limit_max" integer DEFAULT 100 NOT NULL,
	"rate_limit_window_value" integer DEFAULT 1 NOT NULL,
	"rate_limit_window_unit" text DEFAULT 'minute' NOT NULL,
	"worker_image_concurrency" integer DEFAULT 2 NOT NULL,
	"worker_webhook_concurrency" integer DEFAULT 16 NOT NULL,
	"worker_search_index_concurrency" integer DEFAULT 8 NOT NULL,
	"worker_schedule_publish_concurrency" integer DEFAULT 4 NOT NULL,
	"worker_email_concurrency" integer DEFAULT 4 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "system_settings_tenant_id_uniq" UNIQUE NULLS NOT DISTINCT("tenant_id")
);
--> statement-breakpoint
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;