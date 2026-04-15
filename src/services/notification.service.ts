import { supabaseAdmin } from '../utils/supabase';

type ExpoPushMessage = {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: 'default' | null;
  badge?: number;
  channelId?: string;
};

type ExpoPushTicket =
  | { status: 'ok'; id: string }
  | { status: 'error'; message: string; details?: { error: string } };

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const BATCH_SIZE = 100;

/**
 * Send push notifications via Expo Push API.
 * Automatically chunks into batches of 100.
 */
async function sendExpoPushNotifications(
  messages: ExpoPushMessage[]
): Promise<ExpoPushTicket[]> {
  if (messages.length === 0) return [];

  const tickets: ExpoPushTicket[] = [];

  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    const batch = messages.slice(i, i + BATCH_SIZE);
    try {
      const response = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(batch),
      });

      if (!response.ok) {
        console.error(
          `Expo push API error: ${response.status} ${response.statusText}`
        );
        continue;
      }

      const result = (await response.json()) as { data?: ExpoPushTicket[] };
      if (result.data) {
        tickets.push(...result.data);
      }
    } catch (error) {
      console.error('Expo push send error:', error);
    }
  }

  return tickets;
}

/**
 * Get all Expo push tokens for a list of user IDs.
 */
async function getTokensForUsers(
  userIds: string[]
): Promise<Map<string, string[]>> {
  if (userIds.length === 0) return new Map();

  const { data, error } = await supabaseAdmin
    .from('push_tokens')
    .select('user_id, expo_push_token')
    .in('user_id', userIds);

  if (error) {
    console.error('Failed to fetch push tokens:', error.message);
    return new Map();
  }

  const tokenMap = new Map<string, string[]>();
  (data || []).forEach((row) => {
    const current = tokenMap.get(row.user_id) || [];
    current.push(row.expo_push_token);
    tokenMap.set(row.user_id, current);
  });

  return tokenMap;
}

/**
 * Clean up invalid tokens that got DeviceNotRegistered error.
 */
async function cleanupInvalidTokens(tokens: string[]): Promise<void> {
  if (tokens.length === 0) return;

  await supabaseAdmin
    .from('push_tokens')
    .delete()
    .in('expo_push_token', tokens);
}

export type NotificationPayload = {
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

/**
 * Send a push notification to specific users.
 * Handles token lookup, batching, and cleanup of invalid tokens.
 */
export async function notifyUsers(
  userIds: string[],
  notification: NotificationPayload
): Promise<{ sent: number; failed: number }> {
  const tokenMap = await getTokensForUsers(userIds);

  const messages: ExpoPushMessage[] = [];
  tokenMap.forEach((tokens) => {
    tokens.forEach((token) => {
      messages.push({
        to: token,
        title: notification.title,
        body: notification.body,
        data: notification.data,
        sound: 'default',
      });
    });
  });

  if (messages.length === 0) {
    return { sent: 0, failed: 0 };
  }

  const tickets = await sendExpoPushNotifications(messages);

  let sent = 0;
  let failed = 0;
  const invalidTokens: string[] = [];

  tickets.forEach((ticket, index) => {
    if (ticket.status === 'ok') {
      sent++;
    } else {
      failed++;
      if (ticket.details?.error === 'DeviceNotRegistered') {
        invalidTokens.push(messages[index].to);
      }
    }
  });

  // Clean up invalid tokens in the background
  if (invalidTokens.length > 0) {
    cleanupInvalidTokens(invalidTokens).catch(() => {});
  }

  return { sent, failed };
}

/**
 * Send notification to all participants of a fixture except the excluded user.
 */
export async function notifyFixtureParticipants(
  fixtureId: string,
  excludeUserId: string,
  notification: NotificationPayload
): Promise<{ sent: number; failed: number }> {
  const { data: participants } = await supabaseAdmin
    .from('league_fixture_participants')
    .select('user_id')
    .eq('fixture_id', fixtureId);

  const userIds = (participants || [])
    .map((p) => p.user_id)
    .filter((uid) => uid !== excludeUserId);

  return notifyUsers(userIds, notification);
}

/**
 * Send notification to all members of a league except the excluded user.
 */
export async function notifyLeagueMembers(
  leagueId: string,
  excludeUserId: string,
  notification: NotificationPayload
): Promise<{ sent: number; failed: number }> {
  const { data: members } = await supabaseAdmin
    .from('league_members')
    .select('user_id')
    .eq('league_id', leagueId);

  const userIds = (members || [])
    .map((m) => m.user_id)
    .filter((uid) => uid !== excludeUserId);

  return notifyUsers(userIds, notification);
}
