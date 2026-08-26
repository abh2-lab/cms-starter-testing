CREATE TYPE "public"."taxonomy_kind" AS ENUM('category', 'tag');--> statement-breakpoint
ALTER TABLE "taxonomies" ADD COLUMN "kind" "taxonomy_kind" DEFAULT 'category' NOT NULL;