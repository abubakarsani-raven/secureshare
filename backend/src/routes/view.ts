import { Router, Request, Response } from 'express';
import { requireViewSession } from '../middleware/auth';
import { viewLimiter } from '../middleware/rateLimit';
import { findShareByToken, isShareAccessible, incrementViewCount, ShareRecord } from '../services/shareService';
import { downloadFile } from '../services/storage';
import { decryptSerialized, getEncryptionKey } from '../services/encryption';
import { logAudit } from '../services/auditService';
import { getSupabase } from '../services/storage';
import { checkHoneypotAccess } from '../utils/honeypot';
import { xorBase64Fragments } from '../utils/helpers';
import { logger } from '../utils/logger';

const router = Router();

async function getShareForSession(req: Request): Promise<ShareRecord | null> {
  const token = req.params.token;
  const share = await findShareByToken(token);
  if (!share || !req.viewSession) return null;
  if (share.id !== req.viewSession.shareId) return null;
  return share;
}

router.get('/:token/public-info', viewLimiter, async (req: Request, res: Response) => {
  try {
    const share = await findShareByToken(req.params.token);
    if (!share) {
      res.status(404).json({ error: 'Share not found' });
      return;
    }
    const access = isShareAccessible(share);
    res.json({
      type: share.type,
      recipientName: share.recipient_name,
      otpRequired: share.otp_required,
      accessible: access.ok,
      reason: access.reason || null,
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:token/info', viewLimiter, requireViewSession, async (req: Request, res: Response) => {
  try {
    const share = await getShareForSession(req);
    if (!share) {
      res.status(404).json({ error: 'Share not found' });
      return;
    }

    await checkHoneypotAccess(share.id, share.recipient_name);

    const access = isShareAccessible(share);
    if (!access.ok) {
      res.status(403).json({ error: access.reason });
      return;
    }

    await incrementViewCount(share.id);
    await logAudit(share.id, 'content_viewed', req);

    res.json({
      type: share.type,
      recipientName: share.recipient_name,
      pageCount: share.page_count,
      duration: share.duration_seconds,
      chunkCount: share.chunk_count,
      selfDestructSeconds: share.self_destruct_seconds,
    });
  } catch (err) {
    logger.error('View info error', { error: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get(
  '/:token/document/:pageIndex',
  viewLimiter,
  requireViewSession,
  async (req: Request, res: Response) => {
    try {
      const share = await getShareForSession(req);
      if (!share) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      const pageIndex = parseInt(req.params.pageIndex, 10);
      const encrypted = await downloadFile(`shares/${share.id}/pages/${pageIndex}.enc`);
      const decrypted = await decryptSerialized(encrypted, getEncryptionKey());
      res.set({
        'Content-Type': 'image/png',
        'Content-Disposition': 'inline',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      });
      res.send(decrypted);
    } catch (err) {
      res.status(404).json({ error: 'Page not found' });
    }
  }
);

router.get('/:token/image', viewLimiter, requireViewSession, async (req: Request, res: Response) => {
  try {
    const share = await getShareForSession(req);
    if (!share) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const encrypted = await downloadFile(`shares/${share.id}/image.enc`);
    const decrypted = await decryptSerialized(encrypted, getEncryptionKey());
    res.set({
      'Content-Type': 'image/png',
      'Content-Disposition': 'inline',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    });
    res.send(decrypted);
  } catch (err) {
    res.status(404).json({ error: 'Image not found' });
  }
});

router.get('/:token/video/playlist', viewLimiter, requireViewSession, async (req: Request, res: Response) => {
  try {
    const share = await getShareForSession(req);
    if (!share) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const encrypted = await downloadFile(`shares/${share.id}/video/playlist.enc`);
    const decrypted = await decryptSerialized(encrypted, getEncryptionKey());
    let playlist = decrypted.toString('utf8');

    const apiBase = process.env.FRONTEND_URL?.includes('localhost')
      ? `http://localhost:${process.env.PORT || 3001}`
      : process.env.API_URL || `http://localhost:${process.env.PORT || 3001}`;

    playlist = playlist.replace(/segment_\d+\.ts/g, (match) => {
      const idx = match.match(/\d+/)?.[0];
      return `${apiBase}/api/view/${req.params.token}/video/segment/${idx}`;
    });

    res.set({
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Cache-Control': 'no-store',
    });
    res.send(playlist);
  } catch (err) {
    res.status(404).json({ error: 'Playlist not found' });
  }
});

router.get(
  '/:token/video/segment/:segmentIndex',
  viewLimiter,
  requireViewSession,
  async (req: Request, res: Response) => {
    try {
      const share = await getShareForSession(req);
      if (!share) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      const idx = req.params.segmentIndex.padStart(3, '0');
      const encrypted = await downloadFile(`shares/${share.id}/video/segment_${parseInt(req.params.segmentIndex, 10)}.enc`);
      const decrypted = await decryptSerialized(encrypted, getEncryptionKey());
      res.set({
        'Content-Type': 'video/mp2t',
        'Content-Disposition': 'inline',
        'Cache-Control': 'no-store',
      });
      res.send(decrypted);
    } catch (err) {
      res.status(404).json({ error: 'Segment not found' });
    }
  }
);

router.get(
  '/:token/audio/chunk/:chunkIndex',
  viewLimiter,
  requireViewSession,
  async (req: Request, res: Response) => {
    try {
      const share = await getShareForSession(req);
      if (!share) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
      const idx = parseInt(req.params.chunkIndex, 10);
      const encrypted = await downloadFile(`shares/${share.id}/audio/chunk_${idx}.enc`);
      const decrypted = await decryptSerialized(encrypted, getEncryptionKey());
      res.set({
        'Content-Type': 'audio/aac',
        'Content-Disposition': 'inline',
        'Cache-Control': 'no-store',
      });
      res.send(decrypted);
    } catch (err) {
      res.status(404).json({ error: 'Chunk not found' });
    }
  }
);

router.get('/:token/message', viewLimiter, requireViewSession, async (req: Request, res: Response) => {
  try {
    const share = await getShareForSession(req);
    if (!share) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    if (share.destroyed_at) {
      res.status(410).json({ error: 'Message destroyed' });
      return;
    }
    // Mask the stored fragment with the session's OTP-derived fragmentA so the
    // client's A XOR B' XOR C reduces to the real content key (B XOR C).
    const fragmentA = req.viewSession?.keyFragmentA || '';
    res.json({
      ciphertext: share.ciphertext,
      keyFragmentB: xorBase64Fragments(share.key_fragment_b || '', fragmentA),
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:token/message/destroy', viewLimiter, requireViewSession, async (req: Request, res: Response) => {
  try {
    const share = await getShareForSession(req);
    if (!share) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const supabase = getSupabase();
    await supabase.from('shares').update({ destroyed_at: new Date().toISOString() }).eq('id', share.id);
    await logAudit(share.id, 'message_destroyed', req);
    res.json({ destroyed: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
