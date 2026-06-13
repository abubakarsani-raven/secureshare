import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { getSupabase, deleteShareFiles } from '../services/storage';
import { getLastViewedAt } from '../services/auditService';
import { logger } from '../utils/logger';

const router = Router();

router.get('/shares', requireAuth, async (req: Request, res: Response) => {
  try {
    const supabase = getSupabase();
    const { data: shares, error } = await supabase
      .from('shares')
      .select('*')
      .eq('sender_id', req.user!.userId)
      .neq('recipient_name', 'HONEYPOT')
      .order('created_at', { ascending: false });

    if (error) {
      res.status(500).json({ error: 'Failed to fetch shares' });
      return;
    }

    const result = await Promise.all(
      (shares || []).map(async (s) => ({
        id: s.id,
        batchId: s.batch_id,
        type: s.type,
        recipientName: s.recipient_name,
        emailHint: s.recipient_email_hint,
        viewCount: s.view_count,
        maxViews: s.max_views,
        expiresAt: s.expires_at,
        revoked: s.revoked,
        createdAt: s.created_at,
        lastViewedAt: await getLastViewedAt(s.id),
      }))
    );

    res.json(result);
  } catch (err) {
    logger.error('Dashboard shares error', { error: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/shares/:id/audit', requireAuth, async (req: Request, res: Response) => {
  try {
    const supabase = getSupabase();
    const { data: share } = await supabase
      .from('shares')
      .select('id')
      .eq('id', req.params.id)
      .eq('sender_id', req.user!.userId)
      .single();

    if (!share) {
      res.status(404).json({ error: 'Share not found' });
      return;
    }

    const { data: logs } = await supabase
      .from('audit_log')
      .select('*')
      .eq('share_id', req.params.id)
      .order('timestamp', { ascending: false });

    res.json(logs || []);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/shares/:id/revoke', requireAuth, async (req: Request, res: Response) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('shares')
      .update({ revoked: true })
      .eq('id', req.params.id)
      .eq('sender_id', req.user!.userId)
      .select('id')
      .single();

    if (error || !data) {
      res.status(404).json({ error: 'Share not found' });
      return;
    }
    res.json({ revoked: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/shares/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const supabase = getSupabase();
    const { data: share } = await supabase
      .from('shares')
      .select('id, storage_path')
      .eq('id', req.params.id)
      .eq('sender_id', req.user!.userId)
      .single();

    if (!share) {
      res.status(404).json({ error: 'Share not found' });
      return;
    }

    if (share.storage_path) {
      await deleteShareFiles(`shares/${share.id}`);
    }

    await supabase.from('shares').delete().eq('id', share.id);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/stats', requireAuth, async (req: Request, res: Response) => {
  try {
    const supabase = getSupabase();
    const { data: shares } = await supabase
      .from('shares')
      .select('view_count, revoked, expires_at')
      .eq('sender_id', req.user!.userId)
      .neq('recipient_name', 'HONEYPOT');

    const now = new Date();
    const list = shares || [];
    const totalShares = list.length;
    const totalViews = list.reduce((sum, s) => sum + s.view_count, 0);
    const revokedShares = list.filter((s) => s.revoked).length;
    const activeShares = list.filter(
      (s) => !s.revoked && (!s.expires_at || new Date(s.expires_at) > now)
    ).length;

    res.json({ totalShares, totalViews, activeShares, revokedShares });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
