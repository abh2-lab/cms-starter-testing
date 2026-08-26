CREATE TABLE "update_status" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"singleton" text DEFAULT 'singleton' NOT NULL,
	"latest_version" text,
	"latest_type" text,
	"latest_released_at" timestamp with time zone,
	"latest_notes_url" text,
	"min_upgrade_from" text,
	"requires_backup" boolean DEFAULT false NOT NULL,
	"new_env_vars" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"checked_at" timestamp with time zone,
	"check_error" text,
	"check_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "update_status_singleton_uniq" ON "update_status" USING btree ("singleton");