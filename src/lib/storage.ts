import "server-only";
import { getSupabaseAdmin } from "./supabase/admin";

export const BUCKET = "agreements";

export class StorageError extends Error {}

export async function uploadFile(path: string, bytes: Uint8Array, contentType: string, upsert = false): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .storage.from(BUCKET)
    .upload(path, Buffer.from(bytes), { contentType, upsert, cacheControl: "0" });
  if (error) throw new StorageError(`Could not store file: ${error.message}`);
}

export async function downloadFile(path: string): Promise<Uint8Array> {
  const { data, error } = await getSupabaseAdmin().storage.from(BUCKET).download(path);
  if (error || !data) throw new StorageError(`Could not read file: ${error?.message ?? "not found"}`);
  return new Uint8Array(await data.arrayBuffer());
}

/** Short-lived URL for one private file. `downloadName` forces a download with that filename. */
export async function createSignedUrl(path: string, expiresInSeconds = 120, downloadName?: string): Promise<string> {
  const { data, error } = await getSupabaseAdmin()
    .storage.from(BUCKET)
    .createSignedUrl(path, expiresInSeconds, downloadName ? { download: downloadName } : undefined);
  if (error || !data?.signedUrl) throw new StorageError(`Could not authorise file access: ${error?.message ?? "unknown"}`);
  return data.signedUrl;
}

/** One-time URL that lets the browser put a single file at exactly `path` (used for large PDFs). */
export async function createSignedUploadUrl(path: string): Promise<{ path: string; token: string }> {
  const { data, error } = await getSupabaseAdmin().storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new StorageError(`Could not prepare upload: ${error?.message ?? "unknown"}`);
  return { path: data.path, token: data.token };
}

export async function removeFiles(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await getSupabaseAdmin().storage.from(BUCKET).remove(paths);
}

export async function bucketExists(): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin().storage.getBucket(BUCKET);
  return !error && !!data && data.public === false;
}

export function safeFileName(title: string, suffix = ""): string {
  const base = title.replace(/\.pdf$/i, "").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 80) || "agreement";
  return `${base}${suffix}.pdf`;
}
