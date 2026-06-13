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
import {
  shareOptionsSchema,
  recipientsSchema,
  messageBatchSchema,
  parseExpiry,
  expiryFromOption,
} from '../utils/validation';
import { getSupabase, deleteShareFiles } from '../services/storage';
import { generateToken, hashToken } from '../services/tokenService';
import { processPdf } from '../services/processor/pdfProcessor';
import { processImage } from '../services/processor/imageProcessor';
import { processVideo } from '../services/processor/videoProcessor';
import { processAudio } from '../services/processor/audioProcessor';
import { logAudit } from '../services/auditService';
import { WatermarkPayload } from '../services/watermark/lsbWatermark';
import { buildCampaignFingerprints, saveCampaign } from '../services/fingerprint/fingerprintService';
import { packBits } from '../services/fingerprint/tardos';
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

interface Recipient {
  name: string;
  email: string;
}

interface SharedOptions {
  maxViews: number;
  expiresAt: Date | null;
  otpRequired: boolean;
  selfDestructSeconds: number | null;
}

interface CreatedShare {
  recipientName: string;
  recipientEmail: string;
  token: string;
  shareUrl: string;
}

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
  const base = {
    id: shareId,
    sender_id: userId,
    token_hash: tokenHash,
    token_lookup: lookup,
    type,
    watermark_seed: generateWatermarkSeed(),
    storage_path: `shares/${shareId}`,
    ...fields,
  };
  let { data, error } = await supabase.from('shares').insert(base).select('id').single();
  // Retry without the newer columns for deployments that haven't run the
  // campaign / fingerprint migrations yet.
  if (error) {
    const legacy: Record<string, unknown> = { ...base };
    delete legacy.batch_id;
    delete legacy.fingerprint;
    ({ data, error } = await supabase.from('shares').insert(legacy).select('id').single());
  }
  if (error || !data) throw new Error('Failed to create share');
  return data.id;
}

// Removes any uploaded files and share rows from a failed batch so no orphaned
// records or storage objects are left behind.
async function cleanupShares(shareIds: string[]): Promise<void> {
  for (const id of shareIds) {
    try {
      await deleteShareFiles(`shares/${id}`);
    } catch {
      // best effort
    }
    try {
      await getSupabase().from('shares').delete().eq('id', id);
    } catch {
      // best effort
    }
  }
}

function buildShareUrl(token: string, fragmentC?: string): string {
  const base = process.env.FRONTEND_URL || 'http://localhost:3000';
  const url = `${base}/view/${token}`;
  return fragmentC ? `${url}#k=${fragmentC}` : url;
}

// Accepts either a `recipients` JSON array (multi-recipient leak tracing) or a
// single recipientName/recipientEmail pair for backward compatibility.
function parseRecipients(body: Record<string, string>): Recipient[] {
  if (body.recipients) {
    const arr = JSON.parse(body.recipients);
    return recipientsSchema.parse(arr);
  }
  return recipientsSchema.parse([{ name: body.recipientName, email: body.recipientEmail }]);
}

function parseSharedOptions(body: Record<string, string>): SharedOptions {
  const parsed = shareOptionsSchema.parse({
    maxViews: body.maxViews || '1',
    expiresAt: body.expiry ? expiryFromOption(body.expiry)?.toISOString() : body.expiresAt,
    otpRequired: body.otpRequired !== 'false',
    selfDestructSeconds: body.selfDestructSeconds || null,
  });
  return {
    maxViews: parsed.maxViews,
    expiresAt: parseExpiry(parsed.expiresAt as string | undefined),
    otpRequired: parsed.otpRequired,
    selfDestructSeconds: parsed.selfDestructSeconds ?? null,
  };
}

function recipientFields(r: Recipient, options: SharedOptions): Record<string, unknown> {
  return {
    recipient_name: r.name,
    recipient_email_hash: hashEmail(r.email),
    recipient_email_hint: emailHint(r.email),
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

// Runs a per-recipient processing function, creating one uniquely-watermarked
// share per recipient. On any failure the whole batch is rolled back so a leak
// investigation never sees a half-watermarked copy.
async function createForEachRecipient(
  req: Request,
  type: string,
  recipients: Recipient[],
  options: SharedOptions,
  process: (
    shareId: string,
    payload: WatermarkPayload,
    email: string,
    fingerprint: Uint8Array
  ) => Promise<Record<string, unknown>>
): Promise<CreatedShare[]> {
  const shareIds: string[] = [];
  const created: CreatedShare[] = [];
  // One batch id ties all per-recipient copies of this upload together so the
  // dashboard can show them as a single campaign.
  const batchId = randomUUID();
  // Collusion-secure fingerprints: each recipient's copy carries a distinct
  // Tardos codeword so even a colluded leak traces back to a real recipient.
  const fingerprints = buildCampaignFingerprints(recipients.length);
  await saveCampaign(batchId, req.user!.userId, fingerprints);
  try {
    for (let i = 0; i < recipients.length; i++) {
      const r = recipients[i];
      const token = generateToken();
      const shareId = randomUUID();
      shareIds.push(shareId);
      const codewordBits = fingerprints.codewords[i];
      const codeword = packBits(codewordBits);
      const payload = watermarkPayload(shareId, r.email);
      payload.fp = codeword;
      const extra = await process(shareId, payload, r.email, codewordBits);
      await createShareRecord(req.user!.userId, token, type, shareId, {
        batch_id: batchId,
        fingerprint: codeword,
        ...recipientFields(r, options),
        ...extra,
      });
      await logAudit(shareId, 'share_created', req);
      created.push({
        recipientName: r.name,
        recipientEmail: r.email,
        token,
        shareUrl: buildShareUrl(token),
      });
    }
    return created;
  } catch (err) {
    await cleanupShares(shareIds);
    throw err;
  }
}

router.post(
  '/document',
  requireAuth,
  uploadLimiter,
  uploadMemory.single('file'),
  async (req: Request, res: Response) => {
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

      const recipients = parseRecipients(req.body);
      const options = parseSharedOptions(req.body);
      const buffer = req.file.buffer;

      const shares = await createForEachRecipient(req, 'document', recipients, options, async (shareId, payload) => {
        const pageCount = await processPdf(buffer, shareId, payload);
        return { page_count: pageCount };
      });

      res.status(201).json({ shares });
    } catch (err) {
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

      const recipients = parseRecipients(req.body);
      const options = parseSharedOptions(req.body);
      const buffer = req.file.buffer;

      const shares = await createForEachRecipient(req, 'image', recipients, options, async (shareId, payload, _email, fingerprint) => {
        await processImage(buffer, shareId, payload, fingerprint);
        return {};
      });

      res.status(201).json({ shares });
    } catch (err) {
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

      const recipients = parseRecipients(req.body);
      const options = parseSharedOptions(req.body);
      const input = tempPath;

      const shares = await createForEachRecipient(req, 'video', recipients, options, async (shareId) => {
        // The drawtext watermark is keyed to the per-recipient share id.
        const { segmentCount, duration } = await processVideo(input, shareId, shareId.slice(0, 8));
        return { chunk_count: segmentCount, duration_seconds: duration };
      });

      res.status(201).json({ shares });
    } catch (err) {
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

      const recipients = parseRecipients(req.body);
      const options = parseSharedOptions(req.body);
      const input = tempPath;

      const shares = await createForEachRecipient(req, 'audio', recipients, options, async (shareId, payload) => {
        const { chunkCount, duration } = await processAudio(input, shareId, payload);
        return { chunk_count: chunkCount, duration_seconds: duration };
      });

      res.status(201).json({ shares });
    } catch (err) {
      logger.error('Audio upload error', { error: String(err) });
      res.status(500).json({ error: 'Upload failed' });
    } finally {
      if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    }
  }
);

router.post('/message', requireAuth, uploadLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = messageBatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }

    const data = parsed.data;
    const options: SharedOptions = {
      maxViews: data.maxViews,
      expiresAt: parseExpiry(data.expiresAt),
      otpRequired: data.otpRequired,
      selfDestructSeconds: data.selfDestructSeconds ?? null,
    };

    const supabase = getSupabase();
    const shareIds: string[] = [];
    const created: CreatedShare[] = [];
    const batchId = randomUUID();
    try {
      for (const m of data.messages) {
        const token = generateToken();
        const shareId = randomUUID();
        shareIds.push(shareId);
        const row = {
          id: shareId,
          sender_id: req.user!.userId,
          batch_id: batchId,
          token_hash: await hashToken(token),
          token_lookup: tokenLookup(token),
          type: 'message',
          ciphertext: JSON.stringify({ ciphertext: m.ciphertext, iv: m.iv, salt: m.salt }),
          key_fragment_b: m.keyFragmentB,
          ...recipientFields({ name: m.name, email: m.email }, options),
          self_destruct_seconds: options.selfDestructSeconds,
          watermark_seed: generateWatermarkSeed(),
          storage_path: null,
        };
        let { error } = await supabase.from('shares').insert(row);
        if (error) {
          // Retry without batch_id (campaign migration not yet applied).
          const { batch_id: _omit, ...withoutBatch } = row;
          ({ error } = await supabase.from('shares').insert(withoutBatch));
        }
        if (error) throw new Error('Failed to create message share');
        await logAudit(shareId, 'share_created', req);
        // fragmentC stays client-side; the frontend appends it to the URL.
        created.push({ recipientName: m.name, recipientEmail: m.email, token, shareUrl: buildShareUrl(token) });
      }
    } catch (err) {
      await cleanupShares(shareIds);
      throw err;
    }

    res.status(201).json({ shares: created });
  } catch (err) {
    logger.error('Message upload error', { error: String(err) });
    res.status(500).json({ error: 'Upload failed' });
  }
});

export default router;
