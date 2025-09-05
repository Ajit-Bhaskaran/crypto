// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!; // provided by Supabase runtime
const serviceKey = Deno.env.get('SERVICE_ROLE_KEY')!; // set via secrets
const dashboardPassword = Deno.env.get('DASHBOARD_PASSWORD'); // optional

const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

function htmlEscape(s: any): string {
  if (s === null || s === undefined) return '';
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function table<T extends Record<string, any>>(title: string, rows: T[], columns: Array<{ key: keyof T; label: string }>) {
  const thead = columns.map(c => `<th>${htmlEscape(c.label)}</th>`).join('');
  const tbody = rows
    .map(r => `<tr>${columns.map(c => `<td>${htmlEscape(r[c.key])}</td>`).join('')}</tr>`) 
    .join('');
  return `
  <section>
    <h2>${htmlEscape(title)}</h2>
    <div class="table-wrap">
      <table>
        <thead><tr>${thead}</tr></thead>
        <tbody>${tbody || '<tr><td colspan="999">No data</td></tr>'}</tbody>
      </table>
    </div>
  </section>`;
}

serve(async (req) => {
  try {
    const url = new URL(req.url);
    const providedPassword = url.searchParams.get('password') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
    if (dashboardPassword && providedPassword !== dashboardPassword) {
      const body = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Dashboard - Auth Required</title>
      <style>
        body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif; margin:0; padding:2rem;}
        .card{max-width:420px; margin:5rem auto; padding:1.5rem; border:1px solid #e5e7eb; border-radius:12px; box-shadow:0 1px 2px rgba(0,0,0,.04)}
        h1{font-size:1.25rem; margin:0 0 1rem}
        input,button{font:inherit}
        input{width:100%; padding:.6rem .75rem; border:1px solid #cbd5e0; border-radius:8px}
        button{margin-top:.75rem; width:100%; padding:.6rem .75rem; background:#111827; color:#fff; border:0; border-radius:8px}
      </style></head><body>
      <div class="card">
        <h1>Enter password</h1>
        <form method="GET">
          <input type="password" name="password" placeholder="Password" />
          <button type="submit">View Dashboard</button>
        </form>
      </div>
      </body></html>`;
      return new Response(body, { status: 401, headers: { 'content-type': 'text/html; charset=utf-8' } });
    }

    const [signalsRes, ordersRes, positionsRes, auditsRes] = await Promise.all([
      supabase.from('signals').select('*').order('updated_at', { ascending: false }).limit(50),
      supabase.from('orders').select('*').order('created_at', { ascending: false }).limit(50),
      supabase.from('positions').select('*').order('updated_at', { ascending: false }).limit(100),
      supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(50),
    ]);

    if (signalsRes.error) throw signalsRes.error;
    if (ordersRes.error) throw ordersRes.error;
    if (positionsRes.error) throw positionsRes.error;
    if (auditsRes.error) throw auditsRes.error;

    const signals = signalsRes.data ?? [];
    const orders = ordersRes.data ?? [];
    const positions = positionsRes.data ?? [];
    const audits = auditsRes.data ?? [];

    const signalsHtml = table('Signals (latest 50)', signals, [
      { key: 'created_at', label: 'Created' },
      { key: 'updated_at', label: 'Updated' },
      { key: 'asset', label: 'Asset' },
      { key: 'side', label: 'Side' },
      { key: 'entry_price', label: 'Entry' },
      { key: 'target_price', label: 'Target' },
      { key: 'stop_price', label: 'Stop' },
      { key: 'weight', label: 'Weight' },
      { key: 'status', label: 'Status' },
    ]);

    const ordersHtml = table('Orders (latest 50)', orders, [
      { key: 'created_at', label: 'Created' },
      { key: 'asset', label: 'Asset' },
      { key: 'side', label: 'Side' },
      { key: 'order_type', label: 'Type' },
      { key: 'requested_qty', label: 'Qty' },
      { key: 'requested_amount_aud', label: 'Amount (AUD)' },
      { key: 'requested_price', label: 'Price' },
      { key: 'status', label: 'Status' },
      { key: 'provider_order_id', label: 'Provider ID' },
      { key: 'error', label: 'Error' },
    ]);

    const positionsHtml = table('Positions', positions, [
      { key: 'updated_at', label: 'Updated' },
      { key: 'asset', label: 'Asset' },
      { key: 'qty', label: 'Qty' },
      { key: 'avg_entry_price', label: 'Avg Entry' },
      { key: 'realized_pnl', label: 'Realized PnL' },
      { key: 'unrealized_pnl', label: 'Unrealized PnL' },
      { key: 'status', label: 'Status' },
    ]);

    const auditsHtml = table('Audit Logs (latest 50)', audits, [
      { key: 'created_at', label: 'Time' },
      { key: 'scope', label: 'Scope' },
      { key: 'action', label: 'Action' },
      { key: 'ref_id', label: 'Ref' },
      { key: 'details', label: 'Details' },
    ]);

    const body = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Trade Dashboard</title>
  <style>
    :root { color-scheme: light dark; }
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, sans-serif; margin: 0; padding: 0; }
    header { padding: 1rem 1.25rem; border-bottom: 1px solid #e5e7eb; }
    header h1 { font-size: 1.1rem; margin: 0; }
    main { padding: 1rem; max-width: 1200px; margin: 0 auto; }
    section { margin: 1.25rem 0; }
    .table-wrap { overflow: auto; border: 1px solid #e5e7eb; border-radius: 8px; }
    table { border-collapse: collapse; width: 100%; font-size: 14px; }
    th, td { padding: .5rem .6rem; border-bottom: 1px solid #f1f5f9; text-align: left; vertical-align: top; }
    thead th { position: sticky; top: 0; background: #fafafa; }
    h2 { font-size: 1rem; margin: 0 0 .5rem; }
    footer { padding: 1rem 1.25rem; font-size: 12px; color: #6b7280; border-top: 1px solid #e5e7eb; }
  </style>
  </head>
<body>
  <header>
    <h1>Trade Copier Dashboard</h1>
  </header>
  <main>
    ${signalsHtml}
    ${ordersHtml}
    ${positionsHtml}
    ${auditsHtml}
  </main>
  <footer>Generated at ${htmlEscape(new Date().toISOString())}</footer>
</body>
</html>`;

    return new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  } catch (e) {
    return new Response(`Error: ${htmlEscape(e)}`, { status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
});


