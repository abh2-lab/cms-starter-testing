CREATE TYPE "public"."email_provider" AS ENUM('smtp', 'resend', 'brevo', 'stub');--> statement-breakpoint
CREATE TABLE "email_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid,
	"provider" "email_provider" DEFAULT 'stub' NOT NULL,
	"from_name" text,
	"from_address" text,
	"reply_to" text,
	"smtp_host" text,
	"smtp_port" integer DEFAULT 587 NOT NULL,
	"smtp_secure" boolean DEFAULT false NOT NULL,
	"smtp_user" text,
	"smtp_pass_encrypted" "bytea",
	"resend_key_encrypted" "bytea",
	"brevo_key_encrypted" "bytea",
	"notify_on_review" boolean DEFAULT true NOT NULL,
	"notify_on_approval" boolean DEFAULT true NOT NULL,
	"notify_on_publish" boolean DEFAULT false NOT NULL,
	"notify_on_reader_submission" boolean DEFAULT false NOT NULL,
	"notify_on_health_alerts" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_settings_tenant_id_uniq" UNIQUE NULLS NOT DISTINCT("tenant_id")
);
--> statement-breakpoint
ALTER TABLE "email_settings" ADD CONSTRAINT "email_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;