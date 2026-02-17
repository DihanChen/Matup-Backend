import { Router, Request, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { emailSendRateLimit } from '../middleware/rate-limit';
import { supabaseAdmin } from '../utils/supabase';
import { sendGroupEmail } from '../services/email.service';
import { env } from '../config/env';
import { getHostName } from '../utils/profile';
import { buildContextUpdateEmailHtml } from '../templates/email';

const router = Router();

type EmailRequestBody = {
  type: 'event' | 'league';
  id: string;
  subject: string;
  message: string;
};

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

function queueEmailSend(params: {
  recipients: string[];
  subject: string;
  htmlBody: string;
  replyTo?: string;
}): void {
  setImmediate(async () => {
    try {
      await sendGroupEmail(params);
    } catch (error) {
      console.error('Background email send error:', error);
    }
  });
}

router.post('/send', requireAuth, emailSendRateLimit, async (req: Request, res: Response) => {
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

    const htmlBody = buildContextUpdateEmailHtml({
      title: contextTitle,
      hostName,
      message: trimmedMessage,
      link,
      contextLabel,
    });

    if (recipients.length > 10) {
      queueEmailSend({
        recipients,
        subject: trimmedSubject,
        htmlBody,
        replyTo: userEmail || undefined,
      });

      res.status(202).json({
        success: true,
        queued: true,
        recipients: recipients.length,
      });
      return;
    }

    const result = await sendGroupEmail({
      recipients,
      subject: trimmedSubject,
      htmlBody,
      replyTo: userEmail || undefined,
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
