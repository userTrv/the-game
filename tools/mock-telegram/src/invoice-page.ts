import type { Invoice } from './types';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const STYLE = `
  :root { color-scheme: light dark; }
  body { font: 16px/1.5 system-ui, sans-serif; margin: 0; padding: 24px 16px; display: flex; justify-content: center; }
  main { max-width: 420px; width: 100%; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .badge { display: inline-block; font-size: 12px; padding: 2px 8px; border: 1px solid currentColor; border-radius: 999px; opacity: .7; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 16px; margin: 16px 0; }
  dt { opacity: .7; }
  dd { margin: 0; overflow-wrap: anywhere; }
  label { display: block; margin: 16px 0 4px; }
  input { font: inherit; padding: 8px; width: 100%; box-sizing: border-box; }
  button { font: inherit; margin-top: 12px; padding: 10px 16px; width: 100%; cursor: pointer; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; min-height: 1.5em; }
`;

export function renderInvoicePage(invoice: Invoice): string {
  // The invoice id is embedded as JSON; `<` is escaped so the value can never close the script tag.
  const invoiceIdJson = JSON.stringify(invoice.id).replaceAll('<', '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mock invoice: ${escapeHtml(invoice.title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
  <span class="badge">mock Telegram invoice</span>
  <h1>${escapeHtml(invoice.title)}</h1>
  <p>${escapeHtml(invoice.description)}</p>
  <dl>
    <dt>Price</dt><dd>${invoice.amount} XTR (Telegram Stars)</dd>
    <dt>Payload</dt><dd><code>${escapeHtml(invoice.payload)}</code></dd>
    <dt>Invoice id</dt><dd><code>${escapeHtml(invoice.id)}</code></dd>
  </dl>
  <label for="user">Pay as Telegram user id</label>
  <input id="user" type="number" inputmode="numeric" value="1001">
  <button id="pay" type="button">Pay (mock)</button>
  <pre id="result" aria-live="polite"></pre>
</main>
<script>
  const invoiceId = ${invoiceIdJson};
  const userInput = document.getElementById('user');
  const payButton = document.getElementById('pay');
  const result = document.getElementById('result');
  const fromQuery = new URLSearchParams(location.search).get('user');
  if (fromQuery) userInput.value = fromQuery;
  payButton.addEventListener('click', async () => {
    const id = Number(userInput.value);
    if (!Number.isSafeInteger(id) || id <= 0) {
      result.textContent = 'Enter a numeric Telegram user id.';
      return;
    }
    payButton.disabled = true;
    result.textContent = 'Waiting for the bot to answer the pre-checkout query...';
    try {
      const response = await fetch('/control/pay', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ invoiceId, from: { id, first_name: 'Mock user' } }),
      });
      result.textContent = JSON.stringify(await response.json(), null, 2);
    } catch (error) {
      result.textContent = 'Request failed: ' + String(error);
    } finally {
      payButton.disabled = false;
    }
  });
</script>
</body>
</html>
`;
}

export function renderNotFoundPage(): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Mock invoice not found</title><style>${STYLE}</style></head>
<body><main><h1>Invoice not found</h1><p>The mock Telegram server has no invoice with this id. It may have been reset.</p></main></body>
</html>
`;
}
