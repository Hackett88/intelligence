-- Make `row_key` the business unique key for keywords, so we can switch the
-- N8N keywords_pool import script from "DELETE all + INSERT all" to incremental
-- upsert (INSERT ... ON CONFLICT (row_key) DO UPDATE).
--
-- Sanity check first: if any existing row has NULL or empty row_key, fail loud
-- instead of silently breaking the upsert path.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "keywords" WHERE "row_key" IS NULL OR "row_key" = '') THEN
    RAISE EXCEPTION 'Migration aborted: keywords.row_key has NULL or empty values. Clean them before applying.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "keywords"
    WHERE "row_key" IS NOT NULL AND "row_key" <> ''
    GROUP BY "row_key"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Migration aborted: keywords.row_key has duplicate values. Dedupe before applying.';
  END IF;
END $$;
--> statement-breakpoint

ALTER TABLE "keywords" ALTER COLUMN "row_key" SET NOT NULL;
--> statement-breakpoint

ALTER TABLE "keywords" ADD CONSTRAINT "keywords_row_key_unique" UNIQUE ("row_key");
