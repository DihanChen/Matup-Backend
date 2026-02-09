import { Resend } from 'resend';
import { env } from '../config/env';

export type EmailSendFailure = {
  email: string;
  error: string;
};

export type EmailSendResult = {
  sent: number;
  failed: EmailSendFailure[];
};

type SendGroupEmailParams = {
  recipients: string[];
  subject: string;
  htmlBody: string;
  replyTo?: string;
};

const resendClient = env.resendApiKey ? new Resend(env.resendApiKey) : null;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export async function sendGroupEmail({
  recipients,
  subject,
  htmlBody,
  replyTo,
}: SendGroupEmailParams): Promise<EmailSendResult> {
  if (!resendClient) {
    throw new Error('RESEND_API_KEY is not configured');
  }

  if (recipients.length === 0) {
    return { sent: 0, failed: [] };
  }

  const batches = chunk(recipients, 100);
  const failed: EmailSendFailure[] = [];
  let sent = 0;

  for (const batch of batches) {
    try {
      const payload = batch.map((email) => ({
        from: env.resendFrom,
        to: email,
        subject,
        html: htmlBody,
        reply_to: replyTo,
      }));

      const { error } = await resendClient.batch.send(payload);

      if (error) {
        failed.push(
          ...batch.map((email) => ({
            email,
            error: error.message || 'Failed to send email',
          }))
        );
      } else {
        sent += batch.length;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send email';
      failed.push(...batch.map((email) => ({ email, error: message })));
    }
  }

  return { sent, failed };
}
