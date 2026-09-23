export interface EmailContent {
  subject: string;
  html: string;
}

const APP_URL = 'https://jjdia.github.io/propworks';

function wrapper(bodyHtml: string): string {
  return `<div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; color: #1e293b;">
    <h2 style="color: #0f172a;">PropertyWorks</h2>
    ${bodyHtml}
    <p style="color: #64748b; font-size: 12px; margin-top: 24px;">This is an automated message from PropertyWorks.</p>
  </div>`;
}

// --------------------------------------------------------------- onboarding
export function buildOnboardingEmail(tenantName: string, inviteCode: string, ownerName: string): EmailContent {
  return {
    subject: `Welcome — set up your PropertyWorks tenant portal`,
    html: wrapper(`
      <p>Hi ${tenantName},</p>
      <p>${ownerName} has set you up with access to PropertyWorks, where you can submit maintenance requests, get repair updates, and see rent reminders.</p>
      <p><a href="${APP_URL}" style="background:#4f46e5;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block;">Open PropertyWorks</a></p>
      <p>When signing up, choose <strong>"I'm a tenant with an invite code"</strong> and enter this code:</p>
      <p style="font-size:22px;font-weight:bold;letter-spacing:2px;background:#f1f5f9;padding:12px;border-radius:8px;text-align:center;">${inviteCode}</p>
      <p style="font-size:13px;color:#475569;">Tip: after signing in on your phone, tap the Share icon in Safari and choose "Add to Home Screen" so PropertyWorks works like an app.</p>
    `),
  };
}

// ---------------------------------------------------------- maintenance updates
const STATUS_MESSAGE: Record<string, string> = {
  approved_for_bidding: 'has been approved and is now out for contractor bids',
  awarded: 'has a contractor assigned and work will begin soon',
  completed: 'has been marked complete by the contractor',
  closed: 'has been closed',
  rejected: 'was not approved — contact your property manager for details',
};

export function buildMaintenanceUpdateEmail(tenantName: string, requestTitle: string, newStatus: string): EmailContent {
  const message = STATUS_MESSAGE[newStatus] ?? `status changed to "${newStatus}"`;
  return {
    subject: `Update on your maintenance request: ${requestTitle}`,
    html: wrapper(`
      <p>Hi ${tenantName},</p>
      <p>Your maintenance request "<strong>${requestTitle}</strong>" ${message}.</p>
      <p><a href="${APP_URL}" style="background:#4f46e5;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block;">View in PropertyWorks</a></p>
    `),
  };
}

// -------------------------------------------------------------------- broadcast
export function buildBroadcastEmail(tenantName: string, subject: string, body: string): EmailContent {
  return {
    subject,
    html: wrapper(`
      <p>Hi ${tenantName},</p>
      <p>${body.replace(/\n/g, '<br/>')}</p>
    `),
  };
}

