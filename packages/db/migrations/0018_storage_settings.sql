CREATE TYPE "public"."storage_provider" AS ENUM('minio', 'aws', 'r2', 'do', 'gcs');--> statement-breakpoint
CREATE TABLE "storage_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid,
	"provider" "storage_provider" DEFAULT 'minio' NOT NULL,
	"bucket" text NOT NULL,
	"region" text,
	"force_path_style" boolean DEFAULT true NOT NULL,
	"access_key_id" text,
	"secret_access_key_encrypted" "bytea",
	"public_media_url" text,
	"public_api_endpoint" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storage_settings_tenant_id_uniq" UNIQUE NULLS NOT DISTINCT("tenant_id")
);
--> statement-breakpoint
ALTER TABLE "storage_settings" ADD CONSTRAINT "storage_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;