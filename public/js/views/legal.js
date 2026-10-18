import { state, esc } from '../state.js';

/* Starter legal pages. Razorpay (and most gateways) check for terms, privacy, refund and
 * contact pages during account activation. These are templates — have them reviewed for
 * your business before launch. Highlighted text marks details only you can fill in. */

const ph = (t) => `<span class="placeholder">${esc(t)}</span>`;

function pages() {
  const b = state.config.brand;
  const name = esc(b.name);
  const legal = b.legalName && b.legalName !== 'Your Company Name' ? esc(b.legalName) : ph('Your registered business name');
  const addr = b.address && !b.address.startsWith('Your registered') ? esc(b.address) : ph('Registered address');
  const email = b.supportEmail && b.supportEmail !== 'support@example.com' ? `<a href="mailto:${esc(b.supportEmail)}">${esc(b.supportEmail)}</a>` : ph('support email');
  const updated = ph('Last updated date');
  return {
    terms: ['Terms of service', `
      <p>These terms govern your use of ${name}, operated by ${legal} ("we"). By using the service you agree to them. ${updated}</p>
      <h2>The service</h2><p>${name} provides online tools to convert, edit and create documents and images. Some tools run in your browser; others process files on our servers.</p>
      <h2>Your files</h2><p>You keep all rights to files you upload. You give us permission to process them only to provide the tool you chose. You must have the right to use any file you upload.</p>
      <h2>Acceptable use</h2><p>Don't use the service for unlawful content, to infringe others' rights, to attempt to break or overload the service, or to resell it without our written permission.</p>
      <h2>Plans and payments</h2><p>Paid plans (Day Pass, Pro) are prepaid for a fixed period and do not renew automatically. Prices are shown before payment, including GST for Indian customers. Payments are processed by Razorpay (India) and Stripe (international); we never see or store your card details.</p>
      <h2>Availability</h2><p>We aim to keep the service available but don't guarantee it will be uninterrupted or error-free. Always keep your own copy of important documents.</p>
      <h2>Liability</h2><p>To the extent permitted by law, our total liability for any claim is limited to the amount you paid us in the 3 months before the claim.</p>
      <h2>Governing law</h2><p>These terms are governed by the laws of India. Courts at ${ph('city')}, Tamil Nadu have jurisdiction.</p>
      <h2>Contact</h2><p>${legal}, ${addr}. Email ${email}.</p>`],
    privacy: ['Privacy policy', `
      <p>${updated}</p>
      <h2>What we collect</h2><ul>
        <li><b>Account details</b> — your email, name and a securely hashed password, if you create an account.</li>
        <li><b>Files you process</b> — held only while a task runs. Uploaded files are deleted as soon as the task finishes; results are deleted within one hour.</li>
        <li><b>Usage</b> — which tools you used, when, and file sizes, to enforce plan limits and improve the service. We don't read your documents.</li>
        <li><b>Payments</b> — handled by Razorpay or Stripe. We store the plan, amount, status and the payment reference, never card or bank details.</li></ul>
      <h2>Browser-only tools</h2><p>The exam photo resizer and Tamil font converter run entirely on your device. Nothing you put into them is sent to us.</p>
      <h2>Cookies</h2><p>We use one cookie to keep you signed in and one to apply guest limits. We don't use advertising cookies.</p>
      <h2>Sharing</h2><p>We share data only with providers needed to run the service (hosting, payments) and when required by law. We don't sell personal data.</p>
      <h2>Your rights</h2><p>You can ask us to access, correct or delete your account data by emailing ${email}. This policy is intended to meet the Digital Personal Data Protection Act, 2023 — ${ph('confirm with your adviser')}.</p>
      <h2>Grievance officer</h2><p>${ph('Name')}, ${addr}, ${email}.</p>`],
    refunds: ['Refunds & cancellation', `
      <p>${updated}</p>
      <h2>Plans don't auto-renew</h2><p>Day Pass and Pro are one-time, prepaid purchases. There's nothing to cancel — a plan simply ends at the end of its period.</p>
      <h2>Refunds</h2><p>If a paid tool didn't work for your file and we can't fix it, email ${email} within ${ph('7')} days of purchase with your account email and payment reference, and we'll refund you in full. Approved refunds are returned to the original payment method within 5–7 working days.</p>
      <h2>Failed or double payments</h2><p>If money left your account but your plan isn't active, it's usually confirmed within a few minutes. If not, contact us — payments that weren't completed are refunded automatically by the payment provider.</p>`],
    contact: ['Contact us', `
      <p>We're happy to help with questions about tools, payments or your account.</p>
      <h2>Email</h2><p>${email} — we reply within ${ph('1 working day')}.</p>
      <h2>Business details</h2><p>${legal}<br>${addr}${b.gstin ? `<br>GSTIN: ${esc(b.gstin)}` : `<br>GSTIN: ${ph('your GSTIN')}`}<br>Phone: ${ph('phone number')}</p>`],
  };
}

export function renderLegal(main, id) {
  const page = pages()[id];
  if (!page) { main.innerHTML = '<div class="page-head"><h1>Page not found</h1></div>'; return 'Not found'; }
  main.innerHTML = `<article class="prose"><h1>${page[0]}</h1>${page[1]}</article>`;
  return page[0];
}

export function renderDevelopers(main) {
  const origin = esc(location.origin);
  main.innerHTML = `<article class="prose">
    <h1>API for developers</h1>
    <p>Every server-side tool is available over a simple job API, with usage-based billing. Contact ${esc(state.config.brand.supportEmail)} for an API key.</p>
    <h2>Submit a job</h2>
    <pre><code>curl -H "X-API-Key: $KEY" -F tool=compress -F files=@report.pdf \\
  -F 'options={"quality":"ebook"}' ${origin}/api/v1/jobs</code></pre>
    <h2>Check status and download</h2>
    <pre><code>curl -H "X-API-Key: $KEY" ${origin}/api/v1/jobs/&lt;id&gt;
curl -H "X-API-Key: $KEY" -OJ ${origin}/api/v1/jobs/&lt;id&gt;/files/&lt;name&gt;</code></pre>
    <h2>Tools</h2>
    <p><code>GET /api/v1/tools</code> lists every tool name. Options match the fields on each tool's page.</p>
  </article>`;
  return 'API for developers';
}
