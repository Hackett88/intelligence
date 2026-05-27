-- Add `last_manual_w03_at` to keywords: records when a user last manually
-- triggered a W03 (live SERP features) query for this keyword. Front-end
-- DetailDrawer uses this to enforce the "1 manual W03 per keyword per
-- calendar month" quota. NULL means never manually triggered.

ALTER TABLE "keywords" ADD COLUMN "last_manual_w03_at" timestamp with time zone;
