CREATE TYPE "public"."region" AS ENUM('SA', 'ID', 'AE', 'MY', 'GB');--> statement-breakpoint
ALTER TABLE "keywords" ADD COLUMN "region" "region";