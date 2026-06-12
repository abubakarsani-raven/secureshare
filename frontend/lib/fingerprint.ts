let cachedFingerprint: string | null = null;

export async function getFingerprint(): Promise<string> {
  if (cachedFingerprint) return cachedFingerprint;
  const parts = [
    navigator.userAgent,
    navigator.language,
    `${screen.width}x${screen.height}x${screen.colorDepth}`,
    String(new Date().getTimezoneOffset()),
    String(navigator.hardwareConcurrency || 0),
    navigator.platform,
  ].join('|');
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts));
  cachedFingerprint = Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return cachedFingerprint;
}

export async function generateFingerprint(): Promise<string> {
  return getFingerprint();
}
