import { Router, Request, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { supabaseAdmin } from '../utils/supabase';
import { sendGroupEmail } from '../services/email.service';
import { env } from '../config/env';

const router = Router();

type EmailRequestBody = {
  type: 'event' | 'league';
  id: string;
  subject: string;
  message: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatMessage(message: string): string {
  return escapeHtml(message).replace(/\r?\n/g, '<br />');
}

function buildEmailHtml(params: {
  title: string;
  hostName: string;
  message: string;
  link: string;
  contextLabel: string;
}): string {
  const safeMessage = formatMessage(params.message);
  return `
    <div style="font-family: Arial, sans-serif; background: #f8fafc; padding: 24px;">
      <div style="max-width: 640px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e4e4e7; overflow: hidden;">
        <div style="padding: 20px 24px; background: #18181b; color: #ffffff;">
          <div style="font-size: 14px; letter-spacing: 2px; text-transform: uppercase; opacity: 0.7;">MatUp</div>
          <div style="font-size: 20px; font-weight: 700; margin-top: 6px;">${escapeHtml(params.title)}</div>
        </div>
        <div style="padding: 24px;">
          <p style="font-size: 14px; color: #52525b; margin: 0 0 8px;">${escapeHtml(params.hostName)} sent an update to ${escapeHtml(params.contextLabel)}.</p>
          <div style="font-size: 15px; color: #18181b; line-height: 1.6; margin: 0 0 20px;">${safeMessage}</div>
          <a href="${params.link}" style="display: inline-block; padding: 10px 18px; background: #18181b; color: #ffffff; border-radius: 999px; text-decoration: none; font-size: 14px; font-weight: 600;">View Details</a>
        </div>
        <div style="padding: 16px 24px; border-top: 1px solid #f4f4f5; font-size: 12px; color: #71717a;">
          You received this email because you are part of this ${escapeHtml(params.contextLabel)} on MatUp.
        </div>
      </div>
    </div>
  `;
}

async function getHostName(userId: string, fallbackEmail?: string): Promise<string> {
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('name')
    .eq('id', userId)
    .single();

  return profile?.name || fallbackEmail || 'MatUp Host';
}

async function getEmailsForUserIds(userIds: string[]): Promise<string[]> {
  const emails: string[] = [];
  await Promise.all(
    userIds.map(async (id) => {
      const { data, error } = await supabaseAdmin.auth.admin.getUserById(id);
      if (!error && data?.user?.email) {
        emails.push(data.user.email);
      }
    })
  );
  return emails;
}

router.post('/send', requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId, userEmail } = req as AuthenticatedRequest;
    const { type, id, subject, message } = req.body as EmailRequestBody;

    if (!type || !id) {
      res.status(400).json({ error: 'Missing type or id' });
      return;
    }

    const trimmedSubject = subject?.trim();
    const trimmedMessage = message?.trim();

    if (!trimmedSubject || !trimmedMessage) {
      res.status(400).json({ error: 'Subject and message are required' });
      return;
    }

    const hostName = await getHostName(userId, userEmail);
    let recipients: string[] = [];
    let contextLabel = '';
    let contextTitle = '';
    let link = '';

    if (type === 'event') {
      const { data: event, error: eventError } = await supabaseAdmin
        .from('events')
        .select('id, title, creator_id')
        .eq('id', id)
        .single();

      if (eventError || !event) {
        res.status(404).json({ error: 'Event not found' });
        return;
      }

      if (event.creator_id !== userId) {
        res.status(403).json({ error: 'Only the event host can send emails' });
        return;
      }

      const { data: participantRows } = await supabaseAdmin
        .from('event_participants')
        .select('user_id')
        .eq('event_id', id);

      const participantIds = (participantRows || [])
        .map((row) => row.user_id)
        .filter((participantId) => participantId && participantId !== userId);

      recipients = await getEmailsForUserIds(participantIds);
      contextLabel = 'event';
      contextTitle = event.title;
      link = `${env.frontendUrl}/events/${event.id}`;
    } else if (type === 'league') {
      const { data: ownerRow } = await supabaseAdmin
        .from('league_members')
        .select('role')
        .eq('league_id', id)
        .eq('user_id', userId)
        .single();

      if (!ownerRow || ownerRow.role !== 'owner') {
        res.status(403).json({ error: 'Only the league owner can send emails' });
        return;
      }

      const { data: league, error: leagueError } = await supabaseAdmin
        .from('leagues')
        .select('id, name')
        .eq('id', id)
        .single();

      if (leagueError || !league) {
        res.status(404).json({ error: 'League not found' });
        return;
      }

      const { data: memberRows } = await supabaseAdmin
        .from('league_members')
        .select('user_id')
        .eq('league_id', id);

      const memberIds = (memberRows || [])
        .map((row) => row.user_id)
        .filter((memberId) => memberId && memberId !== userId);

      recipients = await getEmailsForUserIds(memberIds);
      contextLabel = 'league';
      contextTitle = league.name;
      link = `${env.frontendUrl}/leagues/${league.id}`;
    } else {
      res.status(400).json({ error: 'Invalid type' });
      return;
    }

    if (recipients.length === 0) {
      res.status(400).json({ error: 'No recipients found' });
      return;
    }

    const htmlBody = buildEmailHtml({
      title: contextTitle,
      hostName,
      message: trimmedMessage,
      link,
      contextLabel,
    });

    const result = await sendGroupEmail({
      recipients,
      subject: trimmedSubject,
      htmlBody,
      replyTo: userEmail,
    });

    res.json({
      success: true,
      sent: result.sent,
      failed: result.failed,
    });
  } catch (error) {
    console.error('Email send error:', error);
    res.status(500).json({ error: 'Failed to send email' });
  }
});

export default router;
