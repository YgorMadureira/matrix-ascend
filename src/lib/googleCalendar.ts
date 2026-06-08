/**
 * googleCalendar.ts
 * Utilitário OAuth + Google Calendar API
 */

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string;
const SCOPES = 'https://www.googleapis.com/auth/calendar.events';

let cachedToken: string | null = null;
let tokenExpiry: number = 0;

export interface CalendarEventPayload {
  summary: string;
  description: string;
  location: string;
  startDateTime: string;
  endDateTime: string;
  attendeeEmail?: string;
  timeZone?: string;
}

function requestToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!window.google?.accounts?.oauth2) {
      reject(new Error('Google Identity Services não carregado.'));
      return;
    }
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: (response: { access_token?: string; error?: string; expires_in?: number }) => {
        if (response.error || !response.access_token) {
          reject(new Error(response.error ?? 'Falha na autenticação Google'));
          return;
        }
        cachedToken = response.access_token;
        tokenExpiry = Date.now() + (response.expires_in ?? 3600) * 1000 - 60000;
        resolve(response.access_token);
      },
    });
    client.requestAccessToken();
  });
}

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  return requestToken();
}

/** Cria um evento e envia convite ao instrutor via Google Calendar */
export async function createCalendarEvent(payload: CalendarEventPayload): Promise<string> {
  const token = await getToken();
  const tz = payload.timeZone ?? 'America/Sao_Paulo';

  const body = {
    summary: payload.summary,
    description: payload.description,
    location: payload.location,
    start: { dateTime: payload.startDateTime, timeZone: tz },
    end:   { dateTime: payload.endDateTime,   timeZone: tz },
    attendees: payload.attendeeEmail ? [{ email: payload.attendeeEmail }] : [],
    guestsCanModify: false,
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'email', minutes: 60 },
        { method: 'popup', minutes: 15 },
      ],
    },
  };

  const res = await fetch(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err?.error?.message ?? 'Erro ao criar evento');
  }

  const data = await res.json();
  return data.id as string;
}

/** Atualiza a descrição de um evento existente */
export async function updateCalendarEvent(eventId: string, description: string): Promise<void> {
  const token = await getToken();
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}?sendUpdates=all`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description }),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? 'Erro ao atualizar evento');
  }
}

/** Cancela um evento — instrutor recebe notificação de cancelamento */
export async function deleteCalendarEvent(eventId: string): Promise<void> {
  const token = await getToken();
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}?sendUpdates=all`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? 'Erro ao cancelar evento');
  }
}
