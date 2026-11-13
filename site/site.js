// JamDay website helpers.
// Set CHECKOUT_URL to your payment link (e.g. a Polar, Stripe or Gumroad checkout) to enable "Get JamDay".
const CHECKOUT_URL = '';

if (CHECKOUT_URL) document.querySelectorAll('[data-checkout]').forEach((a) => { a.href = CHECKOUT_URL; });

// Feedback form: opens the visitor's email app with the message filled in (no server needed).
const form = document.getElementById('feedback');
if (form) {
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const d = new FormData(form);
    const subject = `JamDay feedback: ${d.get('type')}`;
    const body = `${d.get('message')}\n\nDevice: ${d.get('device') || 'not specified'}`;
    location.href = `mailto:${form.dataset.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  });
}

// Close the mobile menu after picking a link.
document.querySelectorAll('#nav a').forEach((a) => a.addEventListener('click', () => document.getElementById('nav').classList.remove('open')));
