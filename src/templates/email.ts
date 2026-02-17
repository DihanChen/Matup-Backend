import { escapeHtml, formatMessage } from '../utils/html';

export function buildContextUpdateEmailHtml(params: {
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

export function buildLeagueInviteEmailHtml(params: {
  leagueName: string;
  hostName: string;
  joinLink: string;
  inviteCode: string;
}): string {
  return `
    <div style="font-family: Arial, sans-serif; background: #f8fafc; padding: 24px;">
      <div style="max-width: 640px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e4e4e7; overflow: hidden;">
        <div style="padding: 20px 24px; background: #18181b; color: #ffffff;">
          <div style="font-size: 14px; letter-spacing: 2px; text-transform: uppercase; opacity: 0.7;">MatUp</div>
          <div style="font-size: 20px; font-weight: 700; margin-top: 6px;">You are invited to join ${escapeHtml(params.leagueName)}</div>
        </div>
        <div style="padding: 24px;">
          <p style="font-size: 14px; color: #52525b; margin: 0 0 8px;">${escapeHtml(params.hostName)} invited you to this league.</p>
          <p style="font-size: 14px; color: #52525b; margin: 0 0 16px;">Join code: <strong>${escapeHtml(params.inviteCode)}</strong></p>
          <a href="${params.joinLink}" style="display: inline-block; padding: 10px 18px; background: #18181b; color: #ffffff; border-radius: 999px; text-decoration: none; font-size: 14px; font-weight: 600;">Join League</a>
        </div>
      </div>
    </div>
  `;
}
