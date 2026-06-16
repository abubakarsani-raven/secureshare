import { Router, Request, Response } from 'express';
import { requireViewSession } from '../middleware/auth';
import { viewLimiter } from '../middleware/rateLimit';
import { findShareByToken, isShareAccessible, incrementViewCount, ShareRecord } from '../services/shareService';
import { downloadFile } from '../services/storage';
import { decryptSerialized, getEncryptionKey } from '../services/encryption';
import { logAudit } from '../services/auditService';
import { notifyCaptureEvent } from '../services/notificationService';
import { getSupabase } from '../services/storage';
import { checkHoneypotAccess } from '../utils/honeypot';
import { xorBase64Fragments } from '../utils/helpers';
import { logger } from '../utils/logger';

const router = Router();

type ShareResult = { share: ShareRecord } | { error: string; status: number };

// Resolves the share for the current view session and enforces revocation,
// destruction, and expiry. Max-views is enforced where the view is consumed
// (/info and OTP verification), not on per-page/segment fetches within a session.
async function getShareForSession(req: Request): Promise<ShareResult> {
  const token = req.params.token;
  const share = await findShareByToken(token);
  if (!share || !req.viewSession || share.id !== req.viewSession.shareId) {
    return { error: 'Share not found', status: 404 };
  }
  if (await checkHoneypotAccess(share.id, share.recipient_name)) {
    return { error: 'Share not found', status: 404 };
  }
  const access = isShareAccessible(share, { ignoreMaxViews: true });
  if (!access.ok) {
    return { error: access.reason || 'forbidden', status: 403 };
  }
  return { share };
}

router.get('/:token/public-info', viewLimiter, async (req: Request, res: Response) => {
  try {
    const share = await findShareByToken(req.params.token);
    if (!share) {
      res.status(404).json({ error: 'Share not found' });
      return;
    }
    if (await checkHoneypotAccess(share.id, share.recipient_name)) {
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
    const result = await getShareForSession(req);
    if ('error' in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    const share = result.share;

    // Max-views is enforced here, where a view is consumed.
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
      const result = await getShareForSession(req);
      if ('error' in result) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      const pageIndex = parseInt(req.params.pageIndex, 10);
      const encrypted = await downloadFile(`shares/${result.share.id}/pages/${pageIndex}.enc`);
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
    const result = await getShareForSession(req);
    if ('error' in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    const encrypted = await downloadFile(`shares/${result.share.id}/image.enc`);
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
    const result = await getShareForSession(req);
    if ('error' in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    const encrypted = await downloadFile(`shares/${result.share.id}/video/playlist.enc`);
    const decrypted = await decryptSerialized(encrypted, getEncryptionKey());
    let playlist = decrypted.toString('utf8');

    // Derive the public base URL from the request (requires trust proxy);
    // API_URL acts as an explicit override.
    const apiBase = process.env.API_URL || `${req.protocol}://${req.get('host')}`;

    // Propagate the session as a query parameter so players that cannot set
    // custom headers (Safari native HLS) can fetch segments.
    const sessionParam =
      typeof req.query.session === 'string'
        ? `?session=${encodeURIComponent(req.query.session)}`
        : '';

    playlist = playlist.replace(/segment_(\d+)\.ts/g, (_match, idx) => {
      return `${apiBase}/api/view/${req.params.token}/video/segment/${parseInt(idx, 10)}${sessionParam}`;
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
      const result = await getShareForSession(req);
      if ('error' in result) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      const idx = parseInt(req.params.segmentIndex, 10);
      const encrypted = await downloadFile(`shares/${result.share.id}/video/segment_${idx}.enc`);
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
      const result = await getShareForSession(req);
      if ('error' in result) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      const idx = parseInt(req.params.chunkIndex, 10);
      const encrypted = await downloadFile(`shares/${result.share.id}/audio/chunk_${idx}.enc`);
      const decrypted = await decryptSerialized(encrypted, getEncryptionKey());
      res.set({
        'Content-Type': 'audio/wav',
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
    const result = await getShareForSession(req);
    if ('error' in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    const share = result.share;
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
    const result = await getShareForSession(req);
    if ('error' in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    const supabase = getSupabase();
    await supabase.from('shares').update({ destroyed_at: new Date().toISOString() }).eq('id', result.share.id);
    await logAudit(result.share.id, 'message_destroyed', req);
    res.json({ destroyed: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Records a best-effort "possible capture" signal reported by the secure viewer
// (a PrintScreen keypress, a screen-recording attempt, or the viewer losing
// focus). These are heuristics, not proof — the browser has no real screenshot
// API — so they are logged to the audit trail as distinct events for the sender
// to review, alongside the forensic watermark that traces an actual leak.
const CAPTURE_EVENTS: Record<string, string> = {
  screenshot: 'possible_screenshot',
  recording: 'screen_recording_attempt',
  focus_lost: 'viewer_focus_lost',
};
router.post('/:token/capture-event', viewLimiter, requireViewSession, async (req: Request, res: Response) => {
  try {
    const result = await getShareForSession(req);
    if ('error' in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    const event = CAPTURE_EVENTS[String(req.body?.type || '')];
    if (!event) {
      res.status(400).json({ error: 'Unknown capture type' });
      return;
    }
    await logAudit(result.share.id, event, req);
    // Email the sender for the high-signal events (throttled inside). Fire-and-
    // forget so it never delays or fails the viewer's response.
    void notifyCaptureEvent(result.share.id, event, req);
    res.json({ logged: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
