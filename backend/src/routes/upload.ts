import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { requireAuth } from '../middleware/auth';
import { uploadLimiter } from '../middleware/rateLimit';
import { virusScan } from '../middleware/virusScan';
import { validateMagicBytes, hashEmail, emailHint, tokenLookup, generateWatermarkSeed } from '../utils/helpers';
import { shareOptionsSchema, messageUploadSchema, parseExpiry, expiryFromOption } from '../utils/validation';
import { getSupabase, deleteShareFiles } from '../services/storage';
import { generateToken, hashToken } from '../services/tokenService';
import { processPdf } from '../services/processor/pdfProcessor';
import { processImage } from '../services/processor/imageProcessor';
import { processVideo } from '../services/processor/videoProcessor';
import { processAudio } from '../services/processor/audioProcessor';
import { logAudit } from '../services/auditService';
import { WatermarkPayload } from '../services/watermark/lsbWatermark';
import { logger } from '../utils/logger';

const router = Router();

const memoryStorage = multer.memoryStorage();
const diskStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.join(os.tmpdir(), 'secureshare-uploads');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});

const uploadMemory = multer({ storage: memoryStorage, limits: { fileSize: 50 * 1024 * 1024 } });
const uploadDisk500 = multer({ storage: diskStorage, limits: { fileSize: 500 * 1024 * 1024 } });
const uploadDisk100 = multer({ storage: diskStorage, limits: { fileSize: 100 * 1024 * 1024 } });

async function createShareRecord(
  userId: string,
  token: string,
  type: string,
  shareId: string,
  fields: Record<string, unknown>
): Promise<string> {
  const supabase = getSupabase();
  const tokenHash = await hashToken(token);
  const lookup = tokenLookup(token);
  const { data, error } = await supabase
    .from('shares')
    .insert({
      id: shareId,
      sender_id: userId,
      token_hash: tokenHash,
      token_lookup: lookup,
      type,
      watermark_seed: generateWatermarkSeed(),
      storage_path: `shares/${shareId}`,
      ...fields,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error('Failed to create share');
  return data.id;
}

// Removes any uploaded files and a possibly half-created share row after a
// failed upload, so no orphaned records or storage objects are left behind.
async function cleanupFailedShare(shareId: string): Promise<void> {
  try {
    await deleteShareFiles(`shares/${shareId}`);
  } catch {
    // best effort
  }
  try {
    await getSupabase().from('shares').delete().eq('id', shareId);
  } catch {
    // best effort
  }
}

function buildShareUrl(token: string, fragmentC?: string): string {
  const base = process.env.FRONTEND_URL || 'http://localhost:3000';
  const url = `${base}/view/${token}`;
  return fragmentC ? `${url}#k=${fragmentC}` : url;
}

function parseShareOptions(body: Record<string, string>): {
  recipientName: string;
  recipientEmail: string;
  maxViews: number;
  expiresAt: Date | null;
  otpRequired: boolean;
  selfDestructSeconds: number | null;
} {
  const parsed = shareOptionsSchema.parse({
    recipientName: body.recipientName,
    recipientEmail: body.recipientEmail,
    maxViews: body.maxViews || '1',
    expiresAt: body.expiry ? expiryFromOption(body.expiry)?.toISOString() : body.expiresAt,
    otpRequired: body.otpRequired !== 'false',
    selfDestructSeconds: body.selfDestructSeconds || null,
  });
  return {
    ...parsed,
    expiresAt: parseExpiry(parsed.expiresAt as string | undefined),
    selfDestructSeconds: parsed.selfDestructSeconds ?? null,
  };
}

function recipientFields(options: ReturnType<typeof parseShareOptions>): Record<string, unknown> {
  return {
    recipient_name: options.recipientName,
    recipient_email_hash: hashEmail(options.recipientEmail),
    recipient_email_hint: emailHint(options.recipientEmail),
    max_views: options.maxViews === 999999 ? 0 : options.maxViews,
    expires_at: options.expiresAt?.toISOString() || null,
    otp_required: options.otpRequired,
  };
}

function watermarkPayload(shareId: string, email: string): WatermarkPayload {
  return {
    recipientId: hashEmail(email).slice(0, 16),
    documentId: shareId,
    sessionId: generateWatermarkSeed(),
    timestamp: Date.now(),
    email: hashEmail(email).slice(0, 32),
  };
}

router.post(
  '/document',
  requireAuth,
  uploadLimiter,
  uploadMemory.single('file'),
  async (req: Request, res: Response) => {
    let shareId: string | null = null;
    try {
      if (!req.file) {
        res.status(400).json({ error: 'File required' });
        return;
      }
      const scan = await virusScan(req.file.buffer);
      if (!scan.clean) {
        res.status(400).json({ error: scan.error });
        return;
      }
      if (!validateMagicBytes(req.file.buffer, 'pdf')) {
        res.status(400).json({ error: 'Invalid PDF file' });
        return;
      }

      const options = parseShareOptions(req.body);
      const token = generateToken();
      shareId = randomUUID();
      const payload = watermarkPayload(shareId, options.recipientEmail);

      const pageCount = await processPdf(req.file.buffer, shareId, payload);

      await createShareRecord(req.user!.userId, token, 'document', shareId, {
        ...recipientFields(options),
        page_count: pageCount,
      });
      await logAudit(shareId, 'share_created', req);

      res.status(201).json({ token, shareUrl: buildShareUrl(token) });
    } catch (err) {
      if (shareId) await cleanupFailedShare(shareId);
      logger.error('Document upload error', { error: String(err) });
      res.status(500).json({ error: 'Upload failed' });
    }
  }
);

router.post(
  '/image',
  requireAuth,
  uploadLimiter,
  uploadMemory.single('file'),
  async (req: Request, res: Response) => {
    let shareId: string | null = null;
    try {
      if (!req.file) {
        res.status(400).json({ error: 'File required' });
        return;
      }
      const scan = await virusScan(req.file.buffer);
      if (!scan.clean) {
        res.status(400).json({ error: scan.error });
        return;
      }

      const ext = req.file.originalname.toLowerCase();
      let magicType = 'jpeg';
      if (ext.endsWith('.png')) magicType = 'png';
      else if (ext.endsWith('.webp')) magicType = 'webp';
      else if (ext.endsWith('.gif')) magicType = 'gif';

      if (!validateMagicBytes(req.file.buffer, magicType)) {
        res.status(400).json({ error: 'Invalid image file' });
        return;
      }

      const options = parseShareOptions(req.body);
      const token = generateToken();
      shareId = randomUUID();
      const payload = watermarkPayload(shareId, options.recipientEmail);

      await processImage(req.file.buffer, shareId, payload);

      await createShareRecord(req.user!.userId, token, 'image', shareId, recipientFields(options));
      await logAudit(shareId, 'share_created', req);

      res.status(201).json({ token, shareUrl: buildShareUrl(token) });
    } catch (err) {
      if (shareId) await cleanupFailedShare(shareId);
      logger.error('Image upload error', { error: String(err) });
      res.status(500).json({ error: 'Upload failed' });
    }
  }
);

router.post(
  '/video',
  requireAuth,
  uploadLimiter,
  uploadDisk500.single('file'),
  async (req: Request, res: Response) => {
    let tempPath: string | null = null;
    let shareId: string | null = null;
    try {
      if (!req.file) {
        res.status(400).json({ error: 'File required' });
        return;
      }
      tempPath = req.file.path;
      const buffer = fs.readFileSync(tempPath);
      const scan = await virusScan(buffer);
      if (!scan.clean) {
        res.status(400).json({ error: scan.error });
        return;
      }

      const ext = req.file.originalname.toLowerCase();
      let magicType = 'mp4';
      if (ext.endsWith('.mov')) magicType = 'mov';
      else if (ext.endsWith('.webm')) magicType = 'webm';
      if (!validateMagicBytes(buffer, magicType)) {
        res.status(400).json({ error: 'Invalid video file' });
        return;
      }

      const options = parseShareOptions(req.body);
      const token = generateToken();
      shareId = randomUUID();

      const watermarkText = shareId.slice(0, 8);
      const { segmentCount, duration } = await processVideo(tempPath, shareId, watermarkText);

      await createShareRecord(req.user!.userId, token, 'video', shareId, {
        ...recipientFields(options),
        chunk_count: segmentCount,
        duration_seconds: duration,
      });
      await logAudit(shareId, 'share_created', req);

      res.status(201).json({ token, shareUrl: buildShareUrl(token) });
    } catch (err) {
      if (shareId) await cleanupFailedShare(shareId);
      logger.error('Video upload error', { error: String(err) });
      res.status(500).json({ error: 'Upload failed' });
    } finally {
      if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    }
  }
);

router.post(
  '/audio',
  requireAuth,
  uploadLimiter,
  uploadDisk100.single('file'),
  async (req: Request, res: Response) => {
    let tempPath: string | null = null;
    let shareId: string | null = null;
    try {
      if (!req.file) {
        res.status(400).json({ error: 'File required' });
        return;
      }
      tempPath = req.file.path;
      const buffer = fs.readFileSync(tempPath);
      const scan = await virusScan(buffer);
      if (!scan.clean) {
        res.status(400).json({ error: scan.error });
        return;
      }

      const ext = req.file.originalname.toLowerCase();
      let magicType = 'mp3';
      if (ext.endsWith('.wav')) magicType = 'wav';
      else if (ext.endsWith('.m4a')) magicType = 'm4a';
      else if (ext.endsWith('.ogg')) magicType = 'ogg';
      if (!validateMagicBytes(buffer, magicType)) {
        res.status(400).json({ error: 'Invalid audio file' });
        return;
      }

      const options = parseShareOptions(req.body);
      const token = generateToken();
      shareId = randomUUID();
      const payload = watermarkPayload(shareId, options.recipientEmail);

      const { chunkCount, duration } = await processAudio(tempPath, shareId, payload);

      await createShareRecord(req.user!.userId, token, 'audio', shareId, {
        ...recipientFields(options),
        chunk_count: chunkCount,
        duration_seconds: duration,
      });
      await logAudit(shareId, 'share_created', req);

      res.status(201).json({ token, shareUrl: buildShareUrl(token) });
    } catch (err) {
      if (shareId) await cleanupFailedShare(shareId);
      logger.error('Audio upload error', { error: String(err) });
      res.status(500).json({ error: 'Upload failed' });
    } finally {
      if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    }
  }
);

router.post('/message', requireAuth, uploadLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = messageUploadSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }

    const data = parsed.data;
    const token = generateToken();
    const shareId = randomUUID();
    const tokenHash = await hashToken(token);
    const lookup = tokenLookup(token);

    const supabase = getSupabase();
    const { error } = await supabase.from('shares').insert({
      id: shareId,
      sender_id: req.user!.userId,
      token_hash: tokenHash,
      token_lookup: lookup,
      type: 'message',
      ciphertext: JSON.stringify({ ciphertext: data.ciphertext, iv: data.iv, salt: data.salt }),
      key_fragment_b: data.keyFragmentB,
      recipient_name: data.recipientName,
      recipient_email_hash: hashEmail(data.recipientEmail),
      recipient_email_hint: emailHint(data.recipientEmail),
      max_views: data.maxViews === 999999 ? 0 : data.maxViews,
      expires_at: data.expiresAt || null,
      otp_required: data.otpRequired,
      self_destruct_seconds: data.selfDestructSeconds || null,
      watermark_seed: generateWatermarkSeed(),
      storage_path: null,
    });

    if (error) {
      res.status(500).json({ error: 'Failed to create message share' });
      return;
    }

    await logAudit(shareId, 'share_created', req);
    const fragmentC = req.body.keyFragmentC as string | undefined;
    res.status(201).json({ token, shareUrl: buildShareUrl(token, fragmentC) });
  } catch (err) {
    logger.error('Message upload error', { error: String(err) });
    res.status(500).json({ error: 'Upload failed' });
  }
});

export default router;
