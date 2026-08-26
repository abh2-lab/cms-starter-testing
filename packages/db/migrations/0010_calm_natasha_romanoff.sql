ALTER TABLE "admin_users" ADD COLUMN "is_protected" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_users" ADD COLUMN "tour_completed_at" timestamp with time zone;--> statement-breakpoint
-- Cheap lookup for GET /admin/setup/status: "does any active super_admin exist?"
CREATE INDEX "admin_users_active_super_admin_idx" ON "admin_users" ("role") WHERE "role" = 'super_admin' AND "is_active" = true;