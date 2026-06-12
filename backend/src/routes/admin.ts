import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import sharp from 'sharp';
import { extractWatermark } from '../services/watermark/extractor';
import { AuthPayload } from '../middleware/auth';
import { getSupabase } from '../services/storage';
import { safeCompare } from '../utils/helpers';
import { logger } from '../utils/logger';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

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

// Reveals the faint visible (on-screen) watermark from a leaked screenshot by
// isolating high-frequency detail (image minus its blur) and stretching the
// contrast. The watermark text rides as low-amplitude pixels that this makes
// legible, independent of whether the background is light or dark. Returns a
// PNG data URL the dashboard can display so a human can read the recipient label.
async function revealWatermark(buffer: Buffer): Promise<string | null> {
  try {
    // The on-screen watermark is dark text at ~10% opacity, so over a light
    // background its pixels land just below white (~225-250). Hard-stretch that
    // near-white band to full range: the faint label becomes dark-on-white and
    // legible, while true content (strong darks) clips to black. Gain/offset map
    // roughly [222,255] -> [0,255].
    const gain = 12;
    const offset = -233 * gain;
    const revealed = await sharp(buffer)
      .greyscale()
      .linear(gain, offset)
      .sharpen()
      .png()
      .toBuffer();
    return `data:image/png;base64,${revealed.toString('base64')}`;
  } catch (err) {
    logger.warn('Watermark reveal failed', { error: String(err) });
    return null;
  }
}

router.post('/extract', requireAdminOrUser, upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'Image file required' });
      return;
    }

    const result = await extractWatermark(req.file.buffer);

    // Always compute a reveal image: the invisible LSB/DCT marks (below) only
    // exist on image/PDF shares and do not survive screenshots, whereas the
    // faint on-screen watermark does — this surfaces it for any screenshot.
    const reveal = await revealWatermark(req.file.buffer);

    if (!result.found || !result.payload) {
      res.json({ found: false, payload: null, reveal });
      return;
    }

    // Non-admin callers may only see watermarks of shares they sent.
    if (req.user) {
      const supabase = getSupabase();
      const { data: share } = await supabase
        .from('shares')
        .select('id')
        .eq('id', result.payload.documentId)
        .eq('sender_id', req.user.userId)
        .single();
      if (!share) {
        res.json({ found: false, payload: null, reveal });
        return;
      }
    }

    res.json({
      found: true,
      method: result.method,
      payload: result.payload,
      reveal,
    });
  } catch (err) {
    logger.error('Extract error', { error: String(err) });
    res.status(500).json({ error: 'Extraction failed' });
  }
});

export default router;
