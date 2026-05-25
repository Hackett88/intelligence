"use server";

import { db } from "@/db/client";
import { keywords, type NewKeyword } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import {
  getKeywordsCached,
  getKeywordStatsCached,
  invalidateKeywordsCache,
} from "@/lib/keywords-cache";

export async function getKeywords() {
  return getKeywordsCached();
}

export async function getKeywordById(id: number) {
  const result = await db.select().from(keywords).where(eq(keywords.id, id));
  return result[0] ?? null;
}

export async function createKeyword(data: NewKeyword) {
  const result = await db.insert(keywords).values(data).returning();
  invalidateKeywordsCache();
  revalidatePath("/app/keywords");
  return result[0];
}

export async function updateKeyword(id: number, data: Partial<NewKeyword>) {
  const result = await db
    .update(keywords)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(keywords.id, id))
    .returning();
  invalidateKeywordsCache();
  revalidatePath("/app/keywords");
  return result[0];
}

export async function deleteKeyword(id: number) {
  await db.delete(keywords).where(eq(keywords.id, id));
  invalidateKeywordsCache();
  revalidatePath("/app/keywords");
}

export async function getKeywordStats() {
  return getKeywordStatsCached();
}
