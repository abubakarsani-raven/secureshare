import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import multer from 'multer';
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

router.post('/extract', requireAdminOrUser, upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'Image file required' });
      return;
    }

    const result = await extractWatermark(req.file.buffer);
    if (!result.found || !result.payload) {
      res.json({ found: false, payload: null });
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
        res.json({ found: false, payload: null });
        return;
      }
    }

    res.json({
      found: true,
      method: result.method,
      payload: result.payload,
    });
  } catch (err) {
    logger.error('Extract error', { error: String(err) });
    res.status(500).json({ error: 'Extraction failed' });
  }
});

export default router;
