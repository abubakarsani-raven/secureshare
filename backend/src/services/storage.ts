import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../utils/logger';

let supabase: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
    }
    supabase = createClient(url, key);
  }
  return supabase;
}

export async function uploadFile(
  path: string,
  data: Buffer,
  contentType: string
): Promise<void> {
  const client = getSupabase();
  const { error } = await client.storage.from('secureshare-files').upload(path, data, {
    contentType,
    upsert: true,
  });
  if (error) throw new Error(`Upload failed: ${error.message}`);
}

export async function downloadFile(path: string): Promise<Buffer> {
  const client = getSupabase();
  const { data, error } = await client.storage.from('secureshare-files').download(path);
  if (error || !data) throw new Error(`Download failed: ${error?.message}`);
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function deleteShareFiles(prefix: string): Promise<void> {
  const client = getSupabase();
  const { data: files, error: listError } = await client.storage
    .from('secureshare-files')
    .list(prefix, { limit: 1000 });
  if (listError) {
    logger.warn('Failed to list files for deletion', { prefix, error: listError.message });
    return;
  }
  if (!files || files.length === 0) return;

  const paths = files.map((f) => `${prefix}/${f.name}`);
  const { error } = await client.storage.from('secureshare-files').remove(paths);
  if (error) logger.warn('Failed to delete files', { prefix, error: error.message });
}

export async function getSignedUrl(path: string, expiresIn = 30): Promise<string> {
  const client = getSupabase();
  const { data, error } = await client.storage
    .from('secureshare-files')
    .createSignedUrl(path, expiresIn);
  if (error || !data?.signedUrl) throw new Error(`Signed URL failed: ${error?.message}`);
  return data.signedUrl;
}

export async function listFiles(prefix: string): Promise<string[]> {
  const client = getSupabase();
  const { data, error } = await client.storage.from('secureshare-files').list(prefix);
  if (error) throw new Error(`List failed: ${error.message}`);
  return (data || []).map((f) => `${prefix}/${f.name}`);
}
