import { getSupabase } from './storage';
import { lookup } from './geoip';
import { parseUserAgent } from '../utils/helpers';
import { Request } from 'express';

export async function logAudit(
  shareId: string,
  event: string,
  req: Request
): Promise<void> {
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || '';
  const ua = req.headers['user-agent'] || '';
  const fp = (req.headers['x-device-fingerprint'] as string) || '';
  const { device, browser, os } = parseUserAgent(ua);
  const geo = await lookup(ip);

  const supabase = getSupabase();
  await supabase.from('audit_log').insert({
    share_id: shareId,
    event,
    ip_address: ip,
    country: geo.country,
    city: geo.city,
    device,
    browser,
    os,
    device_fp: fp,
  });
}

export async function getLastViewedAt(shareId: string): Promise<string | null> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from('audit_log')
    .select('timestamp')
    .eq('share_id', shareId)
    .eq('event', 'content_viewed')
    .order('timestamp', { ascending: false })
    .limit(1)
    .single();
  return data?.timestamp || null;
}
