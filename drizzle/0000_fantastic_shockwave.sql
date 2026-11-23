CREATE TABLE "assets" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"user_id" integer,
	"project_id" varchar(36),
	"logical_name" varchar(180) NOT NULL,
	"filename" varchar(255) NOT NULL,
	"storage_path" text NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"width" integer,
	"height" integer,
	"file_size" integer,
	"version" integer DEFAULT 1 NOT NULL,
	"parent_asset_id" varchar(36),
	"status" varchar(24) DEFAULT 'uploaded' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"entity_type" varchar(40) NOT NULL,
	"entity_id" varchar(36) NOT NULL,
	"action" varchar(80) NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "books" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"project_id" varchar(36) NOT NULL,
	"title" varchar(180) NOT NULL,
	"subtitle" varchar(300) DEFAULT '' NOT NULL,
	"asset_ids_json" text NOT NULL,
	"status" varchar(24) DEFAULT 'queued' NOT NULL,
	"book_pdf_path" text,
	"answer_key_path" text,
	"report_path" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processing_runs" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"asset_id" varchar(36) NOT NULL,
	"state" varchar(24) DEFAULT 'queued' NOT NULL,
	"output_dir" text,
	"engine" varchar(16),
	"confidence" varchar(24),
	"params_json" text DEFAULT '{}' NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" varchar(160) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"uid" text NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_uid_unique" UNIQUE("uid")
);
--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "books" ADD CONSTRAINT "books_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_runs" ADD CONSTRAINT "processing_runs_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_assets_user_id" ON "assets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ix_assets_project_id" ON "assets" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ix_asset_project_name_version" ON "assets" USING btree ("project_id","logical_name","version");--> statement-breakpoint
CREATE INDEX "ix_audit_events_user_id" ON "audit_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ix_books_project_id" ON "books" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ix_processing_runs_asset_id" ON "processing_runs" USING btree ("asset_id");