/** Thin Resend client (plain REST, no SDK) for transactional email — currently just the
 *  password-reset link. Disabled (logs instead of sending) until RESEND_API_KEY is set, so
 *  the app still runs with no email provider configured — password reset requests just log
 *  the would-be email to the server console instead of failing. */

export const emailEnabled = () => Boolean(process.env.RESEND_API_KEY);

export async function sendEmail({ to, subject, html }) {
  if (!emailEnabled()) {
    console.warn(`[email] RESEND_API_KEY not set — would have sent "${subject}" to ${to}:\n${html}`);
    return { skipped: true };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || 'PDF Toolkit <onboarding@resend.dev>',
      to, subject, html,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend: ${data?.message || `HTTP ${res.status}`}`);
  return data;
}
