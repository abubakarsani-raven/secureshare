const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function fromBase64(base64: string): Uint8Array<ArrayBuffer> {
  // Accept both standard and URL-safe base64 (server fragments use base64url)
  const binary = atob(base64.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptMessage(
  plaintext: string,
  password: string
): Promise<{ ciphertext: string; iv: string; salt: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const enc = new TextEncoder();
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
  return {
    ciphertext: toBase64(encrypted),
    iv: toBase64(iv.buffer),
    salt: toBase64(salt.buffer),
  };
}

export async function decryptMessage(
  ciphertext: string,
  iv: string,
  salt: string,
  password: string
): Promise<string> {
  const key = await deriveKey(password, fromBase64(salt));
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(iv) },
    key,
    fromBase64(ciphertext)
  );
  return new TextDecoder().decode(decrypted);
}

export async function deriveKeyFragment(input: string, purpose: string): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(input),
    { name: 'HKDF' },
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode(purpose), info: enc.encode('secureshare') },
    keyMaterial,
    256
  );
  return toBase64(bits);
}

export function combineKeyFragments(fragmentA: string, fragmentB: string, fragmentC: string): string {
  const a = fromBase64(fragmentA);
  const b = fromBase64(fragmentB);
  const c = fromBase64(fragmentC);
  const result = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    result[i] = (a[i] || 0) ^ (b[i] || 0) ^ (c[i] || 0);
  }
  return toBase64(result.buffer);
}

export function generateRandomFragment(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return toBase64(bytes.buffer);
}

export function xorFragments(a: string, b: string): string {
  const bufA = fromBase64(a);
  const bufB = fromBase64(b);
  const result = new Uint8Array(32);
  for (let i = 0; i < 32; i++) result[i] = bufA[i] ^ bufB[i];
  return toBase64(result.buffer);
}

export async function splitKey(keyBase64: string): Promise<{ fragmentB: string; fragmentC: string }> {
  const fragmentC = generateRandomFragment();
  const fragmentB = xorFragments(keyBase64, fragmentC);
  return { fragmentB, fragmentC };
}

export async function encryptWithCombinedKey(plaintext: string, combinedKeyBase64: string): Promise<{
  ciphertext: string;
  iv: string;
}> {
  const keyBytes = fromBase64(combinedKeyBase64);
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
  return { ciphertext: toBase64(encrypted), iv: toBase64(iv.buffer) };
}

export async function decryptWithCombinedKey(
  ciphertext: string,
  iv: string,
  combinedKeyBase64: string
): Promise<string> {
  const keyBytes = fromBase64(combinedKeyBase64);
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(iv) },
    key,
    fromBase64(ciphertext)
  );
  return new TextDecoder().decode(decrypted);
}
