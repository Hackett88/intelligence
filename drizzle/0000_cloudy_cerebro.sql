CREATE TYPE "public"."behavior_intent" AS ENUM('buy', 'compare', 'learn', 'navigate', 'tool');--> statement-breakpoint
CREATE TYPE "public"."bp" AS ENUM('0', '1', '2', '3');--> statement-breakpoint
CREATE TYPE "public"."cannibalization_risk" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."cluster_role" AS ENUM('head', 'modifier', 'variant');--> statement-breakpoint
CREATE TYPE "public"."cp_level" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."cs_level" AS ENUM('commercial', 'mixed', 'informational');--> statement-breakpoint
CREATE TYPE "public"."growth" AS ENUM('rising', 'stable', 'declining');--> statement-breakpoint
CREATE TYPE "public"."handling" AS ENUM('independent', 'merge', 'defer', 'exclude');--> statement-breakpoint
CREATE TYPE "public"."layer" AS ENUM('L1', 'L2', 'L3', 'L4', 'pending');--> statement-breakpoint
CREATE TYPE "public"."page_plan_intent" AS ENUM('product', 'category', 'content', 'tool', 'landing');--> statement-breakpoint
CREATE TYPE "public"."sa_level" AS ENUM('enterable', 'cautious', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."source_num" AS ENUM('0', '1', '2', '3', '4', '5', '6', '7', '8');--> statement-breakpoint
CREATE TYPE "public"."keyword_status" AS ENUM('pending', 'evaluated', 'clustered', 'excluded');--> statement-breakpoint
CREATE TYPE "public"."word_type" AS ENUM('brand', 'category', 'attribute', 'scene', 'audience', 'knowledge', 'comparison', 'geo', 'tool', 'competitor');--> statement-breakpoint
CREATE TABLE "keywords" (
	"id" serial PRIMARY KEY NOT NULL,
	"kw_id" text NOT NULL,
	"raw_keyword" text NOT NULL,
	"normalized_keyword" text NOT NULL,
	"language" text DEFAULT 'EN' NOT NULL,
	"batch_id" text NOT NULL,
	"source_num" "source_num",
	"source_name" text,
	"source_desc" text,
	"word_type" "word_type",
	"bp" "bp",
	"sv" integer,
	"tp" integer,
	"kd" integer,
	"cpc" real,
	"growth" "growth",
	"cp_level" "cp_level",
	"cs_level" "cs_level",
	"sa_level" "sa_level",
	"cluster_code" text,
	"head_keyword" text,
	"cluster_role" "cluster_role",
	"member_count" integer,
	"behavior_intent" "behavior_intent",
	"page_plan_intent" "page_plan_intent",
	"serp_content_type" text,
	"serp_content_format" text,
	"mixed_intent_note" text,
	"layer" "layer",
	"l2_scale_basis" text,
	"l4_sub_type" text,
	"build_batch" text,
	"review_timing" text,
	"layer_basis" text,
	"main_page" text,
	"merge_target_page" text,
	"coverage_method" text,
	"cannibalization_risk" "cannibalization_risk",
	"handling" "handling",
	"keyword_status" "keyword_status" DEFAULT 'pending',
	"notes" text,
	"updated_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "keywords_kw_id_unique" UNIQUE("kw_id")
);
