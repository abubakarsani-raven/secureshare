import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'crypto';

function deriveKey(keyMaterial: string): Buffer {
  const salt = Buffer.from('secureshare-encryption-v1');
  return Buffer.from(hkdfSync('sha256', keyMaterial, salt, 'aes-256-gcm', 32));
}

export interface EncryptedResult {
  encrypted: Buffer;
  iv: string;
  tag: string;
}

export async function encryptBuffer(buffer: Buffer, keyMaterial: string): Promise<EncryptedResult> {
  const key = deriveKey(keyMaterial);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    encrypted,
    iv: iv.toString('base64url'),
    tag: tag.toString('base64url'),
  };
}

export async function decryptBuffer(
  encrypted: Buffer,
  keyMaterial: string,
  iv: string,
  tag: string
): Promise<Buffer> {
  const key = deriveKey(keyMaterial);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

export function serializeEncrypted(result: EncryptedResult): Buffer {
  const ivBuf = Buffer.from(result.iv, 'base64url');
  const tagBuf = Buffer.from(result.tag, 'base64url');
  const header = Buffer.alloc(2);
  header.writeUInt16BE(ivBuf.length);
  const tagHeader = Buffer.alloc(2);
  tagHeader.writeUInt16BE(tagBuf.length);
  return Buffer.concat([header, ivBuf, tagHeader, tagBuf, result.encrypted]);
}

export function deserializeEncrypted(data: Buffer): { encrypted: Buffer; iv: string; tag: string } {
  const ivLen = data.readUInt16BE(0);
  let offset = 2;
  const iv = data.slice(offset, offset + ivLen).toString('base64url');
  offset += ivLen;
  const tagLen = data.readUInt16BE(offset);
  offset += 2;
  const tag = data.slice(offset, offset + tagLen).toString('base64url');
  offset += tagLen;
  const encrypted = data.slice(offset);
  return { encrypted, iv, tag };
}

export async function decryptSerialized(data: Buffer, keyMaterial: string): Promise<Buffer> {
  const { encrypted, iv, tag } = deserializeEncrypted(data);
  return decryptBuffer(encrypted, keyMaterial, iv, tag);
}

export function getEncryptionKey(): string {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) throw new Error('ENCRYPTION_KEY not set');
  return key;
}

export function getWatermarkSecret(): string {
  const key = process.env.WATERMARK_SECRET;
  if (!key) throw new Error('WATERMARK_SECRET not set');
  return key;
}
