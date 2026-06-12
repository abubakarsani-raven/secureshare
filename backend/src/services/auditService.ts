import { getSupabase } from './storage';
import { lookup } from './geoip';
import { parseUserAgent } from '../utils/helpers';
import { Request } from 'express';

export async function logAudit(
  shareId: string,
  event: string,
  req: Request
): Promise<void> {
  // req.ip respects the trust-proxy setting; reading X-Forwarded-For directly
  // would let clients spoof their audit-log IP with an arbitrary header.
  const ip = req.ip || '';
  const ua = req.headers['user-agent'] || '';
  const fp = (req.headers['x-device-fingerprint'] as string) || '';
  const { device, browser, os } = parseUserAgent(ua);
  const geo = await lookup(ip);

  // Precise browser geolocation (GPS/Wi-Fi), captured client-side after the
  // viewer grants permission. Far more accurate than the IP-based city lookup.
  const parseCoord = (h: unknown, min: number, max: number): number | null => {
    const n = typeof h === 'string' ? parseFloat(h) : NaN;
    return Number.isFinite(n) && n >= min && n <= max ? n : null;
  };
  const latitude = parseCoord(req.headers['x-geo-lat'], -90, 90);
  const longitude = parseCoord(req.headers['x-geo-lng'], -180, 180);
  const geoAccuracy = parseCoord(req.headers['x-geo-accuracy'], 0, 1e7);

  const supabase = getSupabase();
  const base = {
    share_id: shareId,
    event,
    ip_address: ip,
    country: geo.country,
    city: geo.city,
    device,
    browser,
    os,
    device_fp: fp,
  };

  const { error } = await supabase
    .from('audit_log')
    .insert({ ...base, latitude, longitude, geo_accuracy: geoAccuracy });

  // Fall back to the base row if the geo columns are not present yet
  // (deployment hasn't run the audit_log geolocation migration).
  if (error) {
    await supabase.from('audit_log').insert(base);
  }
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
