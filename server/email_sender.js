// Pluggable outgoing email for the server (fan confirmation emails for free Beat Store claims).
// Configure with env vars only; nothing here holds a key:
//   EMAIL_PROVIDER   resend | sendgrid | log | none   (optional; picked from whichever key is set)
//   RESEND_API_KEY   when EMAIL_PROVIDER=resend
//   SENDGRID_API_KEY when EMAIL_PROVIDER=sendgrid
//   EMAIL_FROM       the verified sender, e.g. "DJ Battle <beats@yourdomain.com>"
//   APP_PUBLIC_URL   the public web address of the app (used to build the confirm link)
// With no provider configured the sender is a safe no-op that only logs a masked address.

const PROVIDERS = ['resend', 'sendgrid', 'log', 'none'];

function clean(value, max = 500){
  return String(value == null ? '' : value).trim().slice(0, max);
}

function maskEmail(email){
  const text = clean(email, 254);
  const at = text.indexOf('@');
  if(at < 1) return '***';
  return `${text[0]}***${text.slice(at)}`;
}

function parseFrom(value){
  const text = clean(value, 320);
  const match = text.match(/^\s*(.*?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/);
  if(match) return { name:match[1].replace(/^"|"$/g, ''), email:match[2] };
  return /^[^\s@]+@[^\s@]+$/.test(text) ? { name:'', email:text } : null;
}

function resolveEmailProvider(env = process.env){
  const requested = clean(env.EMAIL_PROVIDER).toLowerCase();
  if(requested && PROVIDERS.includes(requested)) return requested;
  if(clean(env.RESEND_API_KEY)) return 'resend';
  if(clean(env.SENDGRID_API_KEY)) return 'sendgrid';
  return 'log';
}

// Which settings are missing, by name only (safe to show to the app owner).
function emailConfigStatus(env = process.env){
  const provider = resolveEmailProvider(env);
  const missing = [];
  if(provider === 'resend' && !clean(env.RESEND_API_KEY)) missing.push('RESEND_API_KEY');
  if(provider === 'sendgrid' && !clean(env.SENDGRID_API_KEY)) missing.push('SENDGRID_API_KEY');
  if(provider === 'resend' || provider === 'sendgrid'){
    if(!parseFrom(env.EMAIL_FROM)) missing.push('EMAIL_FROM');
  }else{
    missing.push('EMAIL_PROVIDER (resend or sendgrid)');
  }
  return { provider, configured:(provider === 'resend' || provider === 'sendgrid') && !missing.length, missing };
}

function createEmailSender(options = {}){
  const env = options.env || process.env;
  const httpClient = options.httpClient || globalThis.fetch;
  const logger = options.logger || console;
  const status = emailConfigStatus(env);
  const from = parseFrom(env.EMAIL_FROM);
  const configured = status.configured && typeof httpClient === 'function';

  async function send(message = {}){
    const to = clean(message.to, 254);
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { error:new Error('Invalid recipient') };
    if(!configured){
      if(status.provider !== 'none' && logger && typeof logger.info === 'function') logger.info(`[email] not sent (no email provider configured): "${clean(message.subject, 120)}" to ${maskEmail(to)}`);
      return { unconfigured:true };
    }
    try{
      if(status.provider === 'resend'){
        const response = await httpClient('https://api.resend.com/emails', {
          method:'POST',
          headers:{ Authorization:`Bearer ${clean(env.RESEND_API_KEY)}`, 'Content-Type':'application/json' },
          body:JSON.stringify({ from:clean(env.EMAIL_FROM, 320), to:[to], subject:clean(message.subject, 200), text:String(message.text || ''), html:String(message.html || '') })
        });
        if(!response || response.ok === false) return { error:new Error(`Resend rejected the email (${response && response.status})`) };
        let data = {};
        try{ data = await response.json(); }catch(e){}
        return { sent:true, id:clean(data && data.id, 160) || null };
      }
      const response = await httpClient('https://api.sendgrid.com/v3/mail/send', {
        method:'POST',
        headers:{ Authorization:`Bearer ${clean(env.SENDGRID_API_KEY)}`, 'Content-Type':'application/json' },
        body:JSON.stringify({
          personalizations:[{ to:[{ email:to }] }],
          from:from.name ? { email:from.email, name:from.name } : { email:from.email },
          subject:clean(message.subject, 200),
          content:[{ type:'text/plain', value:String(message.text || '') }, { type:'text/html', value:String(message.html || '') }]
        })
      });
      if(!response || response.ok === false) return { error:new Error(`SendGrid rejected the email (${response && response.status})`) };
      const id = response.headers && typeof response.headers.get === 'function' ? response.headers.get('x-message-id') : null;
      return { sent:true, id:clean(id, 160) || null };
    }catch(err){
      return { error:new Error('Email provider request failed') };
    }
  }

  return { provider:status.provider, configured, missing:status.missing, send };
}

function escapeHtml(value){
  return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
}

// Link the app reads on load: it posts { leadId, verificationToken } to /api/marketplace/freeEmail/verify,
// then downloads. The token lives in the query string only until the app strips it.
function freeEmailConfirmLink(appUrl, leadId, token){
  const base = clean(appUrl, 500).replace(/[#?].*$/, '').replace(/\/+$/, '');
  if(!/^https?:\/\//i.test(base)) return '';
  return `${base}/?beatConfirm=1&lead=${encodeURIComponent(leadId)}&token=${encodeURIComponent(token)}#store`;
}

function buildFreeEmailConfirmMessage(lead, verification, appUrl){
  const title = clean(verification && verification.listing && verification.listing.title, 160) || 'your free beat';
  const link = freeEmailConfirmLink(appUrl, lead && lead.id, verification && verification.token);
  if(!link) return null;
  return {
    to:lead.email,
    subject:`Confirm your email to download ${title}`,
    text:`Tap the link below to confirm your email and download "${title}" from the DJ Battle Beat Store.\n\n${link}\n\nIf you didn't ask for this, ignore this email.`,
    html:`<p>Tap the button to confirm your email and download <strong>${escapeHtml(title)}</strong> from the DJ Battle Beat Store.</p><p><a href="${escapeHtml(link)}" style="display:inline-block;padding:10px 18px;background:#b9ff31;color:#111;border-radius:8px;text-decoration:none;font-weight:700">Confirm and download</a></p><p style="color:#666;font-size:13px">If you didn't ask for this, ignore this email.</p>`
  };
}

// Gateway for createFreeEmailVerificationAdapter(); null when emails can't actually go out,
// so claims fall back to the instant (unconfirmed) download.
function createFreeEmailVerificationGateway(sender, options = {}){
  const env = options.env || process.env;
  const appUrl = clean(options.appUrl || env.APP_PUBLIC_URL, 500);
  if(!sender || !sender.configured || !/^https?:\/\//i.test(appUrl)) return null;
  return {
    async sendVerificationEmail(lead, verification){
      const message = buildFreeEmailConfirmMessage(lead, verification, appUrl);
      if(!message) return { unconfigured:true };
      const result = await sender.send(message);
      if(result.unconfigured) return { unconfigured:true };
      if(result.error) return { error:result.error };
      return { sent:true, id:result.id || null };
    }
  };
}

function freeEmailConfirmationsStatus(env = process.env){
  const status = emailConfigStatus(env);
  const missing = status.missing.slice();
  if(!/^https?:\/\//i.test(clean(env.APP_PUBLIC_URL))) missing.push('APP_PUBLIC_URL');
  return { provider:status.provider, configured:status.configured && !missing.length, missing };
}

module.exports = {
  buildFreeEmailConfirmMessage,
  createEmailSender,
  createFreeEmailVerificationGateway,
  emailConfigStatus,
  freeEmailConfirmLink,
  freeEmailConfirmationsStatus,
  maskEmail,
  parseFrom,
  resolveEmailProvider
};
