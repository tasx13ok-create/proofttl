const SITE_TITLE = "ProofTTL — expiring source-backed facts";

export function renderLandingPage() {
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="ProofTTL issues expiring, source-backed fact leases for machines.">
  <title>${SITE_TITLE}</title>
  <style nonce="${nonce}">
    :root {
      color-scheme: dark;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #090b10;
      color: #f5f7fb;
    }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: radial-gradient(circle at 20% 0%, #18233b 0, #0b0e15 34rem, #090b10 60rem); }
    a { color: inherit; }
    .shell { width: min(1100px, calc(100% - 32px)); margin: 0 auto; padding: 28px 0 72px; }
    nav { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 72px; }
    .brand { font-weight: 800; letter-spacing: -0.03em; font-size: 1.1rem; text-decoration: none; }
    .navlinks { display: flex; gap: 18px; flex-wrap: wrap; font-size: .9rem; color: #b8c0cf; }
    .navlinks a { text-decoration: none; }
    .navlinks a:hover { color: #fff; }
    .hero { max-width: 840px; }
    .eyebrow { display: inline-flex; align-items: center; gap: 8px; border: 1px solid #2b3548; border-radius: 999px; padding: 7px 11px; color: #c4cada; background: #10151f; font-size: .8rem; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #6ee7a8; box-shadow: 0 0 18px rgba(110,231,168,.45); }
    h1 { margin: 20px 0 18px; font-size: clamp(3rem, 8vw, 6.7rem); line-height: .94; letter-spacing: -.065em; max-width: 930px; }
    .lead { max-width: 720px; color: #aeb7c7; font-size: clamp(1.05rem, 2vw, 1.35rem); line-height: 1.65; }
    .actions { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 30px; }
    .button { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0 16px; border-radius: 10px; border: 1px solid #30394b; text-decoration: none; font-weight: 700; background: #151b27; }
    .button.primary { background: #f4f7fb; color: #0b0d12; border-color: #f4f7fb; }
    .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; margin-top: 68px; }
    .card { border: 1px solid #242c3a; background: rgba(15,19,28,.78); border-radius: 16px; padding: 20px; }
    .card strong { display: block; margin-bottom: 9px; font-size: 1rem; }
    .card p { margin: 0; color: #9da7b8; line-height: 1.55; font-size: .92rem; }
    .demo { margin-top: 28px; border: 1px solid #293244; background: rgba(12,16,24,.92); border-radius: 18px; padding: clamp(20px, 4vw, 30px); }
    .demo h2 { margin: 0 0 8px; font-size: 1.45rem; }
    .demo > p { margin: 0 0 20px; color: #9fa9ba; line-height: 1.55; }
    form { display: grid; grid-template-columns: 1.15fr 1.5fr .55fr auto; gap: 10px; align-items: end; }
    label { display: grid; gap: 7px; color: #aab3c2; font-size: .78rem; font-weight: 700; }
    input { width: 100%; min-height: 43px; border-radius: 9px; border: 1px solid #303a4d; background: #0c1018; color: #f3f5f8; padding: 0 11px; outline: none; }
    input:focus { border-color: #7c8cab; }
    button { min-height: 43px; border: 0; border-radius: 9px; padding: 0 15px; font: inherit; font-weight: 800; cursor: pointer; background: #eaf0f8; color: #0c0e13; }
    button:disabled { opacity: .55; cursor: wait; }
    pre { margin: 18px 0 0; min-height: 132px; max-height: 360px; overflow: auto; white-space: pre-wrap; word-break: break-word; border-radius: 12px; border: 1px solid #252e3e; background: #080b10; color: #bcd0bd; padding: 15px; font: 12px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .fine { margin-top: 10px; color: #778297; font-size: .76rem; }
    footer { margin-top: 56px; padding-top: 20px; border-top: 1px solid #202734; display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; color: #7f899b; font-size: .8rem; }
    @media (max-width: 850px) {
      nav { margin-bottom: 48px; }
      .grid { grid-template-columns: 1fr; }
      form { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <nav>
      <a class="brand" href="/">ProofTTL</a>
      <div class="navlinks">
        <a href="/.well-known/proofttl.json">Discovery</a>
        <a href="/openapi.json">OpenAPI</a>
        <a href="/pricing">Pricing</a>
        <a href="/health">Health</a>
      </div>
    </nav>

    <section class="hero">
      <div class="eyebrow"><span class="dot"></span> Base Sepolia testnet</div>
      <h1>Facts should expire when their sources change.</h1>
      <p class="lead">ProofTTL turns a claim, a source URL, and a TTL into a machine-readable Fact Lease: source-backed, time-bounded, automatically monitored, and revocable.</p>
      <div class="actions">
        <a class="button primary" href="/.well-known/proofttl.json">Machine discovery</a>
        <a class="button" href="/openapi.json">Read the API</a>
      </div>
    </section>

    <section class="grid" aria-label="ProofTTL capabilities">
      <article class="card">
        <strong>Source-grounded</strong>
        <p>ProofTTL answers whether the specified source currently supports the exact claim. It prefers UNKNOWN over invented certainty.</p>
      </article>
      <article class="card">
        <strong>Expires + monitors</strong>
        <p>Leases carry an expiry and are automatically checked for source changes. A changed source can revoke an active lease.</p>
      </article>
      <article class="card">
        <strong>Machine-paid</strong>
        <p>Verification is gated by x402. The current public deployment is testnet-only at $0.001 USDC per verification.</p>
      </article>
    </section>

    <section class="demo" aria-labelledby="demo-title">
      <h2 id="demo-title">Request the x402 challenge</h2>
      <p>This sends an unpaid verification request and shows the server response plus decoded payment requirements. It never signs or authorizes a payment.</p>
      <form id="challenge-form">
        <label>Claim
          <input id="claim" name="claim" maxlength="1000" value="Example Domain" required>
        </label>
        <label>Source URL
          <input id="source" name="source" type="url" value="https://example.com" required>
        </label>
        <label>TTL seconds
          <input id="ttl" name="ttl" type="number" min="1" max="604800" value="300" required>
        </label>
        <button id="submit" type="submit">Request</button>
      </form>
      <pre id="output" aria-live="polite">Ready. No payment will be authorized by this page.</pre>
      <div class="fine">Public manual reverification is disabled. Active leases are monitored automatically.</div>
    </section>

    <footer>
      <span>ProofTTL/0.3.1</span>
      <span>Testnet only · Base Sepolia · source-backed ≠ universal truth</span>
    </footer>
  </main>

  <script nonce="${nonce}">
    const form = document.getElementById('challenge-form');
    const output = document.getElementById('output');
    const button = document.getElementById('submit');

    function decodePaymentRequired(value) {
      if (!value) return null;
      try {
        const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
        const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
        return JSON.parse(atob(padded));
      } catch {
        return { decode_error: true };
      }
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      button.disabled = true;
      output.textContent = 'Requesting unpaid x402 challenge…';

      try {
        const response = await fetch('/verify', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            claim: document.getElementById('claim').value,
            source_url: document.getElementById('source').value,
            ttl_seconds: Number(document.getElementById('ttl').value)
          })
        });

        let body = null;
        try { body = await response.json(); } catch {}

        const paymentRequired = decodePaymentRequired(response.headers.get('payment-required'));
        output.textContent = JSON.stringify({
          http_status: response.status,
          body,
          payment_required: paymentRequired
        }, null, 2);
      } catch (error) {
        output.textContent = JSON.stringify({ error: String(error) }, null, 2);
      } finally {
        button.disabled = false;
      }
    });
  </script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=60",
      "content-security-policy": `default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self' data:`,
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "permissions-policy": "camera=(), microphone=(), geolocation=()"
    }
  });
}
