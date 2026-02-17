import { randomUUID } from 'node:crypto';
import { Request, Response, Router } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { sendGroupEmail } from '../services/email.service';
import { ensureLeagueInviteCode, getLeague } from '../services/league.service';
import { buildLeagueInviteEmailHtml } from '../templates/email';
import { getHostName } from '../utils/profile';
import { env } from '../config/env';
import { getLeagueRole, isLeagueAdminRole } from '../utils/league-access';
import { supabaseAdmin } from '../utils/supabase';

const router = Router();

type LeagueInviteRow = {
  id: string;
  league_id: string;
  email: string;
  token: string;
  status: 'pending' | 'accepted' | 'expired';
  invited_by: string | null;
  invited_at: string;
  claimed_by: string | null;
  claimed_at: string | null;
  expires_at: string | null;
};

function normalizeInviteEmails(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const normalized = input
    .map((item) => (typeof item === 'string' ? item.trim().toLowerCase() : ''))
    .filter((email) => emailRegex.test(email));
  return [...new Set(normalized)];
}

router.get('/preview-by-code/:code', requireAuth, async (req: Request, res: Response) => {
  try {
    const codeParam = Array.isArray(req.params.code) ? req.params.code[0] : req.params.code;
    const inviteCode = typeof codeParam === 'string' ? codeParam.trim().toUpperCase() : '';

    if (!inviteCode) {
      res.status(400).json({ error: 'invite code is required' });
      return;
    }

    const { data: league, error } = await supabaseAdmin
      .from('leagues')
      .select('id, name, sport_type, scoring_format')
      .ilike('invite_code', inviteCode)
      .maybeSingle();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    if (!league) {
      res.status(404).json({ error: 'League not found' });
      return;
    }

    res.json(league);
  } catch (error) {
    console.error('League preview by code error:', error);
    res.status(500).json({ error: 'Failed to preview league' });
  }
});

router.get('/:id/invites', requireAuth, async (req: Request, res: Response) => {
  try {
    const leagueId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { userId } = req as AuthenticatedRequest;

    if (!leagueId) {
      res.status(400).json({ error: 'league id is required' });
      return;
    }

    const role = await getLeagueRole(leagueId, userId);
    if (!isLeagueAdminRole(role)) {
      res.status(403).json({ error: 'Only league owner/admin can view invites' });
      return;
    }

    const league = await getLeague(leagueId);
    if (!league) {
      res.status(404).json({ error: 'League not found' });
      return;
    }

    const inviteCode = await ensureLeagueInviteCode(leagueId, league.invite_code);
    const { data: invites, error } = await supabaseAdmin
      .from('league_invites')
      .select('id, email, status, invited_at, claimed_at, expires_at')
      .eq('league_id', leagueId)
      .order('invited_at', { ascending: false });

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json({
      inviteCode,
      invites: invites || [],
    });
  } catch (error) {
    console.error('League invites fetch error:', error);
    res.status(500).json({ error: 'Failed to load invites' });
  }
});

router.post('/:id/invites', requireAuth, async (req: Request, res: Response) => {
  try {
    const leagueId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { userId, userEmail } = req as AuthenticatedRequest;
    const emails = normalizeInviteEmails(req.body?.emails);

    if (!leagueId) {
      res.status(400).json({ error: 'league id is required' });
      return;
    }

    if (emails.length === 0) {
      res.status(400).json({ error: 'At least one valid email is required' });
      return;
    }

    const role = await getLeagueRole(leagueId, userId);
    if (!isLeagueAdminRole(role)) {
      res.status(403).json({ error: 'Only league owner/admin can send invites' });
      return;
    }

    const league = await getLeague(leagueId);
    if (!league) {
      res.status(404).json({ error: 'League not found' });
      return;
    }

    const inviteCode = await ensureLeagueInviteCode(leagueId, league.invite_code);
    const inviteRows = emails.map((email) => ({
      league_id: leagueId,
      email,
      token: randomUUID(),
      status: 'pending',
      invited_by: userId,
      invited_at: new Date().toISOString(),
      claimed_by: null,
      claimed_at: null,
    }));

    const { data: savedInvites, error: upsertError } = await supabaseAdmin
      .from('league_invites')
      .upsert(inviteRows, { onConflict: 'league_id,email' })
      .select(
        'id, league_id, email, token, status, invited_by, invited_at, claimed_by, claimed_at, expires_at'
      );

    if (upsertError) {
      res.status(500).json({ error: upsertError.message });
      return;
    }

    const subject = `You're invited to join ${league.name} on MatUp`;
    const hostName = await getHostName(userId, userEmail);

    let sent = 0;
    let failed: Array<{ email: string; error: string }> = [];
    let emailError: string | null = null;

    try {
      const inviteRowsToSend = (savedInvites || []) as LeagueInviteRow[];
      for (const invite of inviteRowsToSend) {
        if (invite.status !== 'pending') {
          continue;
        }

        const joinLink = `${env.frontendUrl}/leagues/join?code=${inviteCode}&inviteToken=${invite.token}`;
        const htmlBody = buildLeagueInviteEmailHtml({
          leagueName: league.name,
          hostName,
          joinLink,
          inviteCode,
        });
        const sendResult = await sendGroupEmail({
          recipients: [invite.email],
          subject,
          htmlBody,
          replyTo: userEmail,
        });
        sent += sendResult.sent;
        failed.push(...sendResult.failed);
      }
    } catch (sendError) {
      emailError =
        sendError instanceof Error ? sendError.message : 'Failed to send invite emails';
    }

    const { data: invites, error: inviteFetchError } = await supabaseAdmin
      .from('league_invites')
      .select('id, email, status, invited_at, claimed_at, expires_at')
      .eq('league_id', leagueId)
      .order('invited_at', { ascending: false });

    if (inviteFetchError) {
      res.status(500).json({ error: inviteFetchError.message });
      return;
    }

    res.json({
      success: true,
      inviteCode,
      sent,
      failed,
      emailError,
      invites: invites || [],
    });
  } catch (error) {
    console.error('League invite send error:', error);
    res.status(500).json({ error: 'Failed to send invites' });
  }
});

router.post('/:id/join', requireAuth, async (req: Request, res: Response) => {
  try {
    const leagueId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { userId, userEmail } = req as AuthenticatedRequest;
    const inviteCode =
      typeof req.body?.inviteCode === 'string' ? req.body.inviteCode.trim() : '';
    const inviteToken =
      typeof req.body?.inviteToken === 'string' ? req.body.inviteToken.trim() : '';

    if (!leagueId) {
      res.status(400).json({ error: 'league id is required' });
      return;
    }

    if (!inviteCode && !inviteToken) {
      res.status(400).json({ error: 'inviteCode or inviteToken is required' });
      return;
    }

    const league = await getLeague(leagueId);
    if (!league) {
      res.status(404).json({ error: 'League not found' });
      return;
    }

    const currentRole = await getLeagueRole(leagueId, userId);
    if (currentRole) {
      res.json({ success: true, alreadyMember: true });
      return;
    }

    let inviteRow: LeagueInviteRow | null = null;
    if (inviteToken) {
      const { data } = await supabaseAdmin
        .from('league_invites')
        .select(
          'id, league_id, email, token, status, invited_by, invited_at, claimed_by, claimed_at, expires_at'
        )
        .eq('league_id', leagueId)
        .eq('token', inviteToken)
        .eq('status', 'pending')
        .single();
      inviteRow = (data as LeagueInviteRow | null) || null;

      if (!inviteRow) {
        res.status(403).json({ error: 'Invite token is invalid or expired' });
        return;
      }

      if (!userEmail || inviteRow.email.toLowerCase() !== userEmail.toLowerCase()) {
        res.status(403).json({ error: 'Invite token does not match your account email' });
        return;
      }
    } else {
      const leagueInviteCode = await ensureLeagueInviteCode(leagueId, league.invite_code);
      if (inviteCode.toUpperCase() !== leagueInviteCode.toUpperCase()) {
        res.status(403).json({ error: 'Invite code is invalid' });
        return;
      }
    }

    const { error: insertError } = await supabaseAdmin
      .from('league_members')
      .insert({
        league_id: leagueId,
        user_id: userId,
        role: 'member',
      });

    if (insertError && insertError.code !== '23505') {
      res.status(500).json({ error: insertError.message });
      return;
    }

    const now = new Date().toISOString();
    if (inviteRow) {
      await supabaseAdmin
        .from('league_invites')
        .update({
          status: 'accepted',
          claimed_by: userId,
          claimed_at: now,
        })
        .eq('id', inviteRow.id);
    } else if (userEmail) {
      await supabaseAdmin
        .from('league_invites')
        .update({
          status: 'accepted',
          claimed_by: userId,
          claimed_at: now,
        })
        .eq('league_id', leagueId)
        .eq('status', 'pending')
        .ilike('email', userEmail);
    }

    res.json({ success: true, alreadyMember: false });
  } catch (error) {
    console.error('League join error:', error);
    res.status(500).json({ error: 'Failed to join league' });
  }
});

export default router;
