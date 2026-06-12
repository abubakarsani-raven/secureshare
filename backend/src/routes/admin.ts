import { Router, Request, Response } from 'express';
import multer from 'multer';
import { extractWatermark } from '../services/watermark/extractor';
import { logger } from '../utils/logger';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

function requireAdmin(req: Request, res: Response, next: () => void): void {
  const secret = req.headers['x-admin-secret'];
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
}

router.post('/extract', requireAdmin, upload.single('file'), async (req: Request, res: Response) => {
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
