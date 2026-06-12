import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().email(),
  password: z
    .string()
    .min(8)
    .regex(/[A-Z]/, 'Must contain uppercase')
    .regex(/[0-9]/, 'Must contain number')
    .regex(/[^A-Za-z0-9]/, 'Must contain special character'),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  totpCode: z.string().optional(),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export const otpSendSchema = z.object({
  token: z.string().min(1),
  email: z.string().email(),
});

export const otpVerifySchema = z.object({
  token: z.string().min(1),
  email: z.string().email(),
  code: z.string().length(6).regex(/^\d+$/),
});

export const messageUploadSchema = z.object({
  ciphertext: z.string().min(1).max(500000),
  iv: z.string().min(1),
  salt: z.string().optional().default(''),
  keyFragmentB: z.string().min(1),
  recipientName: z.string().min(1).max(200),
  recipientEmail: z.string().email(),
  maxViews: z.coerce.number().int().min(1).max(999999).default(1),
  expiresAt: z.string().optional().nullable(),
  selfDestructSeconds: z.coerce.number().int().optional().nullable(),
  otpRequired: z.coerce.boolean().default(true),
});

export const shareOptionsSchema = z.object({
  recipientName: z.string().min(1).max(200),
  recipientEmail: z.string().email(),
  maxViews: z.coerce.number().int().min(1).max(999999).default(1),
  expiresAt: z.string().optional().nullable(),
  otpRequired: z.coerce.boolean().default(true),
  selfDestructSeconds: z.coerce.number().int().optional().nullable(),
});

export function parseExpiry(expiresAt: string | null | undefined): Date | null {
  if (!expiresAt || expiresAt === 'never') return null;
  const date = new Date(expiresAt);
  return isNaN(date.getTime()) ? null : date;
}

export function expiryFromOption(option: string): Date | null {
  const now = Date.now();
  const map: Record<string, number> = {
    '1hr': 3600000,
    '6hr': 6 * 3600000,
    '24hr': 24 * 3600000,
    '48hr': 48 * 3600000,
    '7days': 7 * 24 * 3600000,
    never: 0,
  };
  const ms = map[option];
  if (!ms) return null;
  if (ms === 0) return null;
  return new Date(now + ms);
}
