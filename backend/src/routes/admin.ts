import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import sharp from 'sharp';
import { createWorker, Worker } from 'tesseract.js';
import { extractWatermark } from '../services/watermark/extractor';
import { AuthPayload } from '../middleware/auth';
import { getSupabase } from '../services/storage';
import { safeCompare } from '../utils/helpers';
import { logger } from '../utils/logger';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// On-screen watermark tilt (matches uAngle in the GpuWatermark shader). Used to
// deskew the revealed image so the label is horizontal for OCR.
const WATERMARK_TILT_DEG = 28.6;

// Accepts either the operator secret (full access, used by ops/CLI) or a
// logged-in user's JWT (results restricted to that user's own shares).
function requireAdminOrUser(req: Request, res: Response, next: NextFunction): void {
  const secret = req.headers['x-admin-secret'];
  if (typeof secret === 'string' && process.env.ADMIN_SECRET && safeCompare(secret, process.env.ADMIN_SECRET)) {
    next();
    return;
  }

  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      const jwtSecret = process.env.JWT_SECRET;
      if (!jwtSecret) throw new Error('JWT_SECRET not set');
      req.user = jwt.verify(header.slice(7), jwtSecret) as AuthPayload;
      next();
      return;
    } catch {
      // fall through to 403
    }
  }

  res.status(403).json({ error: 'Forbidden' });
}

// High-contrast grayscale buffer that surfaces the on-screen watermark for
// display and OCR. normalise() stretches the (already dark) watermark to full
// range; upscaling 2x gives the OCR engine cleaner glyph edges.
async function revealBuffer(buffer: Buffer): Promise<Buffer> {
  const meta = await sharp(buffer).metadata();
  const width = (meta.width || 800) * 2;
  return sharp(buffer).greyscale().normalise().resize({ width }).png().toBuffer();
}

// Lazily created, reused OCR worker. Loading the model is expensive, so keep one
// alive across requests rather than per call.
let ocrWorker: Promise<Worker> | null = null;
function getOcrWorker(): Promise<Worker> {
  if (!ocrWorker) ocrWorker = createWorker('eng');
  return ocrWorker;
}

// Reads the watermark text out of a revealed image. The label is tiled at a
// fixed tilt, so OCR is run on the image deskewed both ways plus upright and the
// results are concatenated — any orientation that lands upright contributes text.
async function ocrRevealed(revealed: Buffer): Promise<string> {
  try {
    const worker = await getOcrWorker();
    const variants = await Promise.all(
      [0, -WATERMARK_TILT_DEG, WATERMARK_TILT_DEG].map((deg) =>
        deg === 0
          ? Promise.resolve(revealed)
          : sharp(revealed).rotate(deg, { background: '#ffffff' }).png().toBuffer()
      )
    );
    let text = '';
    for (const v of variants) {
      const { data } = await worker.recognize(v);
      text += ' ' + data.text;
    }
    return text;
  } catch (err) {
    logger.warn('Watermark OCR failed', { error: String(err) });
    return '';
  }
}

const normalize = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

interface ShareMatch {
  recipientName: string;
  emailHint: string;
  shareId: string;
  type: string;
  createdAt: string;
  viewCount: number;
  confidence: number;
}

// Matches OCR'd watermark text against the caller's own shares by recipient
// name, tolerant of OCR noise: scores the fraction of a recipient's name words
// (>=3 chars) that appear anywhere in the recognized text.
async function matchOwnShare(userId: string, ocrText: string): Promise<ShareMatch | null> {
  const haystack = normalize(ocrText);
  if (!haystack) return null;

  const supabase = getSupabase();
  const { data: shares } = await supabase
    .from('shares')
    .select('id, recipient_name, recipient_email_hint, type, created_at, view_count')
    .eq('sender_id', userId)
    .neq('recipient_name', 'HONEYPOT');
  if (!shares || shares.length === 0) return null;

  let best: ShareMatch | null = null;
  for (const s of shares) {
    const words = normalize(s.recipient_name).split(' ').filter((w) => w.length >= 3);
    if (words.length === 0) continue;
    const hit = words.filter((w) => haystack.includes(w)).length;
    const confidence = hit / words.length;
    if (confidence >= 0.5 && (!best || confidence > best.confidence)) {
      best = {
        recipientName: s.recipient_name,
        emailHint: s.recipient_email_hint,
        shareId: s.id,
        type: s.type,
        createdAt: s.created_at,
        viewCount: s.view_count,
        confidence,
      };
    }
  }
  return best;
}

router.post('/extract', requireAdminOrUser, upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'Image file required' });
      return;
    }

    const result = await extractWatermark(req.file.buffer);

    // The invisible LSB/DCT marks only exist on image/PDF shares and do not
    // survive screenshots; the faint on-screen watermark does. Reveal it, OCR
    // it, and match the text against the caller's own shares to name the leak.
    let reveal: string | null = null;
    let ocrText = '';
    let match: ShareMatch | null = null;
    try {
      const revealed = await revealBuffer(req.file.buffer);
      reveal = `data:image/png;base64,${revealed.toString('base64')}`;
      ocrText = await ocrRevealed(revealed);
      if (req.user) match = await matchOwnShare(req.user.userId, ocrText);
    } catch (err) {
      logger.warn('Reveal/OCR failed', { error: String(err) });
    }

    if (!result.found || !result.payload) {
      res.json({ found: false, payload: null, reveal, ocrText, match });
      return;
    }

    // Non-admin callers may only see embedded watermarks of shares they sent.
    if (req.user) {
      const supabase = getSupabase();
      const { data: share } = await supabase
        .from('shares')
        .select('id')
        .eq('id', result.payload.documentId)
        .eq('sender_id', req.user.userId)
        .single();
      if (!share) {
        res.json({ found: false, payload: null, reveal, ocrText, match });
        return;
      }
    }

    res.json({
      found: true,
      method: result.method,
      payload: result.payload,
      reveal,
      ocrText,
      match,
    });
  } catch (err) {
    logger.error('Extract error', { error: String(err) });
    res.status(500).json({ error: 'Extraction failed' });
  }
});

export default router;
