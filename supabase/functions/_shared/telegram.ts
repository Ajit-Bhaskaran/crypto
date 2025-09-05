const token = Deno.env.get('TELEGRAM_BOT_TOKEN');
const chatId = Deno.env.get('TELEGRAM_CHAT_ID');

if (!token) {
  throw new Error('Missing TELEGRAM_BOT_TOKEN');
}
if (!chatId) {
  throw new Error('Missing TELEGRAM_CHAT_ID');
}

export async function sendTelegram(text: string) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Telegram error ${resp.status}: ${body}`);
  }
}


