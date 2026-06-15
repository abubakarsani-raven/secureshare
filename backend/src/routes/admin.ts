import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import sharp from 'sharp';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import path from 'path';
import ffmpegStatic from 'ffmpeg-static';
import { createWorker, Worker } from 'tesseract.js';
import { extractWatermark } from '../services/watermark/extractor';
import { AuthPayload } from '../middleware/auth';
import { getSupabase } from '../services/storage';
import { safeCompare } from '../utils/helpers';
import { traceImageLeak, TraceResult } from '../services/fingerprint/fingerprintService';
import { logger } from '../utils/logger';

const execFileAsync = promisify(execFile);

const router = Router();
// 100 MB: large enough to accept a leaked short video clip, not just a screenshot.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

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
// display and OCR. normalise() stretches the min→max range so the faint
// watermark text becomes visible; upscaling 2x gives the OCR engine cleaner
// glyph edges. Works well on smooth backgrounds (plain pages, photos, video
// frames) where the watermark is the darkest/lightest structure.
async function revealBuffer(buffer: Buffer): Promise<Buffer> {
  const meta = await sharp(buffer).metadata();
  const width = (meta.width || 800) * 2;
  return sharp(buffer).greyscale().normalise().resize({ width }).png().toBuffer();
}

// Orientation-enhanced reveal for screenshots of dense documents, where plain
// normalise is swamped by horizontal body text. The on-screen watermark sits at
// a fixed 28.6° diagonal while body text runs horizontally, so we subtract a
// horizontally-blurred copy of the image: a horizontal run (body-text line) is
// largely preserved by the blur and cancels out, while the diagonal watermark
// differs from its horizontal blur and survives. OCR'ing this in addition to the
// plain reveal recovers watermark glyphs that body text would otherwise bury.
async function revealOriented(buffer: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(buffer).greyscale().raw().toBuffer({ resolveWithObject: true });
  const downW = Math.max(1, Math.round(info.width / 9));
  // Cheap horizontal-only blur: shrink along x then stretch back, averaging ~9px
  // horizontally while leaving vertical detail intact.
  const hblur = await sharp(data, { raw: info })
    .resize(downW, info.height, { kernel: 'cubic' })
    .resize(info.width, info.height, { kernel: 'cubic' })
    .raw()
    .toBuffer();
  const out = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) {
    const v = 128 + (data[i] - hblur[i]) * 2.5;
    out[i] = v < 0 ? 0 : v > 255 ? 255 : v;
  }
  return sharp(out, { raw: info }).normalise().resize({ width: info.width * 2 }).png().toBuffer();
}

// Lazily created, reused OCR worker. Loading the model is expensive, so keep one
// alive across requests rather than per call.
let ocrWorker: Promise<Worker> | null = null;
function getOcrWorker(): Promise<Worker> {
  if (!ocrWorker) ocrWorker = createWorker('eng');
  return ocrWorker;
}

// Reads the watermark text from the already-revealed (normalised) buffer. The
// reveal pass produces clean black-on-white glyphs, so OCR runs on it directly
// (an extra gamma/threshold "binarize" pass only mangled the already-clean text
// and is not used). Runs OCR at three rotations so whichever angle lands the
// diagonal watermark label horizontal contributes the clean text.
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
  source: 'embedded' | 'ocr';
}

// Builds a match from a share id (the embedded watermark's documentId). This is
// exact — no OCR guessing — so confidence is 100%. Scoped to the caller's own
// shares unless an operator secret was used (userId omitted).
async function matchByShareId(shareId: string, userId?: string): Promise<ShareMatch | null> {
  const supabase = getSupabase();
  let query = supabase
    .from('shares')
    .select('id, recipient_name, recipient_email_hint, type, created_at, view_count')
    .eq('id', shareId);
  if (userId) query = query.eq('sender_id', userId);
  const { data: s } = await query.single();
  if (!s) return null;
  return {
    recipientName: s.recipient_name,
    emailHint: s.recipient_email_hint,
    shareId: s.id,
    type: s.type,
    createdAt: s.created_at,
    viewCount: s.view_count,
    confidence: 1,
    source: 'embedded',
  };
}

// Extracts candidate token-prefix runs from raw OCR text. The watermark label is
// "RecipientName · XXXXXXXX" where the last segment is the first 8 chars of the
// share token. OCR introduces noise (split runs, dropped trailing glyph), so we
// keep every 6–10 char run and let the fuzzy matcher do the rest.
function extractTokenCandidates(ocrText: string): string[] {
  const seen = new Set<string>();
  for (const m of ocrText.matchAll(/[A-Za-z0-9_-]{6,10}/g)) {
    seen.add(m[0]);
    if (m[0].length > 8) seen.add(m[0].slice(0, 8));
  }
  return [...seen];
}

// Canonicalises a token for OCR-tolerant comparison: lowercases and collapses
// visually-confusable glyph classes to one representative (O/0, l/1/I, S/5, …).
// The share token is case-sensitive base64url full of ambiguous characters, so
// an exact OCR read almost never matches — but the canonical form does.
function canonToken(s: string): string {
  return s
    .toLowerCase()
    .replace(/[o0]/g, '0')
    .replace(/[il1|!]/g, '1')
    .replace(/[s5]/g, '5')
    .replace(/[b6]/g, '6')
    .replace(/[g9q]/g, '9')
    .replace(/[z2]/g, '2')
    .replace(/[^a-z0-9]/g, '');
}

// Levenshtein edit distance, used to tolerate the handful of glyph errors OCR
// makes on a faint watermark even after canonicalisation.
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}

interface OwnShare {
  id: string;
  recipient_name: string;
  recipient_email_hint: string;
  type: string;
  created_at: string;
  view_count: number;
  token_prefix: string | null;
}

function toMatch(s: OwnShare, confidence: number): ShareMatch {
  return {
    recipientName: s.recipient_name,
    emailHint: s.recipient_email_hint,
    shareId: s.id,
    type: s.type,
    createdAt: s.created_at,
    viewCount: s.view_count,
    confidence,
    source: 'ocr',
  };
}

// Fuzzy token-prefix match: the on-screen watermark carries the first 8 chars of
// the share token. OCR rarely recovers them exactly (O↔0, dropped trailing
// glyph, …), so we canonicalise both sides and accept the closest share within a
// small edit distance. Random 8-char prefixes effectively never collide within
// distance 1, so this is safe even with a margin gate for distance-2 hits.
function matchByTokenPrefix(ocrText: string, shares: OwnShare[]): ShareMatch | null {
  const cands = extractTokenCandidates(ocrText).map(canonToken).filter((c) => c.length >= 5);
  if (cands.length === 0) return null;

  let best: OwnShare | null = null;
  let bestDist = Infinity;
  let secondDist = Infinity;
  for (const s of shares) {
    if (!s.token_prefix) continue;
    const cp = canonToken(s.token_prefix);
    let dist = Infinity;
    for (const c of cands) {
      // Allow OCR to drop trailing glyph(s): also compare against cp's head.
      const head = cp.slice(0, c.length);
      dist = Math.min(dist, levenshtein(c, cp), c.length >= 6 ? levenshtein(c, head) : Infinity);
    }
    if (dist < bestDist) { secondDist = bestDist; bestDist = dist; best = s; }
    else if (dist < secondDist) { secondDist = dist; }
  }
  if (!best) return null;
  // Distance 0–1 is a near-certain hit; distance 2 only when clearly the winner.
  if (bestDist <= 1) return toMatch(best, bestDist === 0 ? 1 : 0.95);
  if (bestDist <= 2 && secondDist - bestDist >= 2) return toMatch(best, 0.85);
  return null;
}

// Matches OCR'd watermark text against the caller's own shares. Tries the
// token-prefix fuzzy match first (most reliable — a near-unique code), then
// falls back to recipient-name matching: the fraction of a recipient's name
// words (>=3 chars) that appear anywhere in the recognized text.
async function matchOwnShare(userId: string, ocrText: string): Promise<ShareMatch | null> {
  const haystack = normalize(ocrText);
  if (!haystack) return null;

  const supabase = getSupabase();
  const { data: shares } = await supabase
    .from('shares')
    .select('id, recipient_name, recipient_email_hint, type, created_at, view_count, token_prefix')
    .eq('sender_id', userId)
    .neq('recipient_name', 'HONEYPOT');
  if (!shares || shares.length === 0) return null;

  const byPrefix = matchByTokenPrefix(ocrText, shares as OwnShare[]);
  if (byPrefix) return byPrefix;

  let best: ShareMatch | null = null;
  for (const s of shares as OwnShare[]) {
    const words = normalize(s.recipient_name).split(' ').filter((w) => w.length >= 3);
    if (words.length === 0) continue;
    const hit = words.filter((w) => haystack.includes(w)).length;
    const confidence = hit / words.length;
    if (confidence >= 0.5 && (!best || confidence > best.confidence)) {
      best = toMatch(s, confidence);
    }
  }
  return best;
}

// Samples frames from a leaked video so the burned-in drawtext mark can be read.
// The mark flickers in for a few frames at a time, so we sample densely (a few
// frames per second, capped) to land on frames that contain it. Returns the
// decoded PNG frame buffers.
async function sampleVideoFrames(buffer: Buffer, maxFrames = 36): Promise<Buffer[]> {
  if (!ffmpegStatic) return [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-extract-'));
  try {
    const inPath = path.join(dir, 'leak');
    fs.writeFileSync(inPath, buffer);
    // 4 fps gives several chances to catch the intermittent mark without
    // decoding the whole video; cap the count to bound OCR work.
    await execFileAsync(ffmpegStatic, [
      '-y', '-i', inPath, '-vf', 'fps=4', '-frames:v', String(maxFrames),
      path.join(dir, 'f%03d.png'),
    ]);
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.png'))
      .sort()
      .map((f) => fs.readFileSync(path.join(dir, f)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

router.post('/extract', requireAdminOrUser, upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'Image file required' });
      return;
    }

    const isVideo = (req.file.mimetype || '').startsWith('video/');

    const result = isVideo
      ? { found: false, method: null, payload: null }
      : await extractWatermark(req.file.buffer);

    let match: ShareMatch | null = null;
    let collusion: { threshold: number; ranked: TraceResult[] } | null = null;

    // Preferred path: an embedded LSB/DCT watermark (image/PDF originals) carries
    // the exact share id, so we can identify the recipient with certainty.
    if (result.found && result.payload) {
      match = await matchByShareId(result.payload.documentId, req.user?.userId);
    }

    let reveal: string | null = null;
    let ocrText = '';
    try {
      if (isVideo) {
        // Leaked video: read the burned-in drawtext mark. It flickers across a
        // few frames, so sample several, OCR each, and keep the cleanest reveal
        // for display. Any frame that recovers the token prefix identifies it.
        const frames = await sampleVideoFrames(req.file.buffer);
        for (const frame of frames) {
          const revealed = await revealBuffer(frame);
          if (!reveal) reveal = `data:image/png;base64,${revealed.toString('base64')}`;
          const text = await ocrRevealed(revealed);
          ocrText += ' ' + text;
          if (req.user && !match) {
            const hit = await matchOwnShare(req.user.userId, text);
            if (hit) { match = hit; reveal = `data:image/png;base64,${revealed.toString('base64')}`; break; }
          }
        }
      } else {
        // Screenshot / still image: a screenshot has no embedded mark, but the
        // faint on-screen watermark survives — reveal it, OCR it, fuzzy-match.
        const revealed = await revealBuffer(req.file.buffer);
        reveal = `data:image/png;base64,${revealed.toString('base64')}`;
        if (!match) {
          ocrText = await ocrRevealed(revealed);
          // Add an orientation-enhanced pass that suppresses horizontal body
          // text, recovering watermark glyphs a dense document would bury. Both
          // passes' text is unioned before matching, so this only ever helps.
          const oriented = await revealOriented(req.file.buffer);
          ocrText += ' ' + (await ocrRevealed(oriented));
          if (req.user) match = await matchOwnShare(req.user.userId, ocrText);
        }
      }
    } catch (err) {
      logger.warn('Reveal/OCR failed', { error: String(err) });
    }

    // Collusion-secure trace: once we know which campaign the leak belongs to,
    // extract the spread-spectrum Tardos fingerprint from the leaked pixels and
    // score the whole campaign. This still names a real leaker even when several
    // recipients colluded to splice a mixed copy — what a plain per-recipient
    // watermark cannot do.
    if (match?.shareId && !isVideo) {
      try {
        const { data: share } = await getSupabase()
          .from('shares')
          .select('batch_id')
          .eq('id', match.shareId)
          .single();
        if (share?.batch_id) {
          collusion = await traceImageLeak(share.batch_id, req.file.buffer, req.user?.userId);
        }
      } catch (err) {
        logger.warn('Collusion trace failed', { error: String(err) });
      }
    }

    // Only expose the raw embedded payload for shares the caller owns.
    const showPayload = result.found && result.payload && (!req.user || match?.source === 'embedded');

    res.json({
      found: !!showPayload,
      method: showPayload ? result.method : null,
      payload: showPayload ? result.payload : null,
      reveal,
      ocrText,
      match,
      collusion,
    });
  } catch (err) {
    logger.error('Extract error', { error: String(err) });
    res.status(500).json({ error: 'Extraction failed' });
  }
});

// Manual search: the caller supplies text they read off the revealed watermark
// image (a recipient name, the share code, or both). We match against their own
// shares by name (fuzzy) and token prefix (exact), returning the best hit.
router.get('/search-shares', requireAdminOrUser, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const query = String(req.query.q || '').trim();
    if (!query) {
      res.status(400).json({ error: 'q required' });
      return;
    }

    // matchOwnShare handles both fuzzy token-prefix and recipient-name matching
    // against the caller's own shares.
    const match = await matchOwnShare(req.user.userId, query);
    res.json({ match });
  } catch (err) {
    logger.error('Search error', { error: String(err) });
    res.status(500).json({ error: 'Search failed' });
  }
});

export default router;
