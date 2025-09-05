// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { parse as parseCsv } from 'https://deno.land/std@0.224.0/csv/mod.ts';
import { sendTelegram } from '../_shared/telegram.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseKey = Deno.env.get('SERVICE_ROLE_KEY')!;
const SHEET_URL = Deno.env.get('SHEET_URL')!;
const SHEET_TAB = Deno.env.get('SHEET_TAB') || 'Trades';

const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

function csvToRows(csv: string): string[][] {
  const parsed = parseCsv(csv) as unknown as string[][];
  return parsed.map(row => row.map(cell => (cell ?? '').toString().trim())) as string[][];
}

function normalizeHeader(h: string) {
  return h.toLowerCase().replace(/\s+/g, '_');
}

function sanitizeNumber(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[$,\s\"]/g, '');
  const n = Number(cleaned);
  return isNaN(n) ? null : n;
}

function parseRow(header: string[], cells: string[]) {
  const map: Record<string, string> = {};
  header.forEach((h, i) => map[normalizeHeader(h)] = (cells[i] ?? '').trim());

  const asset = map['asset'] || map['coin'] || map['ticker'];
  const typeRaw = (map['type'] || '').toUpperCase();
  const structure = (map['structure'] || '').toUpperCase();
  // Derive side from type/structure
  const side = typeRaw.includes('SELL') ? 'SELL' : (typeRaw.includes('LONG') ? 'BUY' : (typeRaw.includes('BUY') ? 'BUY' : 'BUY'));
  const entry = sanitizeNumber(map['price_at_trade'] || map['entry'] || map['entry_price'] || map['price'] || '');
  const target = sanitizeNumber(map['target'] || map['exit_$'] || map['exit_price'] || '');
  const stop = sanitizeNumber(map['stop'] || map['stop_loss'] || map['stop_loss_/_strike'] || map['sl'] || '');
  const weight = sanitizeNumber(map['weight'] || map['allocation'] || map['trade_size'] || map['capital_locked'] || map['size'] || '');
  const status = map['status'] || map['state'] || '';
  const notes = map['notes'] || '';

  const tradeNo = map['trade_no.'] || map['trade_no'] || '';
  const tradeDate = map['date'] || map['trade_date'] || '';
  const sheetRowId = tradeNo && asset ? `trade#${tradeNo}:${asset}` : JSON.stringify({ asset, typeRaw, entry, tradeDate });

  return {
    trade_date: tradeDate ? new Date(tradeDate) : null,
    asset,
    side,
    entry_price: entry,
    target_price: target,
    stop_price: stop,
    weight: weight,
    status,
    notes,
    sheet_row_id: sheetRowId,
  };
}

async function upsertSignal(parsed: any) {
  const { data: existing, error: findErr } = await supabase
    .from('signals')
    .select('*')
    .eq('sheet_row_id', parsed.sheet_row_id)
    .maybeSingle();

  if (findErr) throw findErr;

  if (!existing) {
    const { data, error } = await supabase
      .from('signals')
      .insert([{ ...parsed }])
      .select()
      .single();
    if (error) throw error;

    await sendTelegram(`New trade: ${data.side} ${data.asset} ` +
      (data.entry_price ? `@ ${data.entry_price}` : '') +
      (data.target_price ? ` | Target ${data.target_price}` : ''));

    await supabase.from('audit_logs').insert([{
      scope: 'SHEET',
      action: 'NEW_SIGNAL',
      ref_id: data.id,
      details: data,
    }]);

    return { kind: 'new', data };
  } else {
    const diffKeys = ['side','entry_price','target_price','stop_price','weight','status','notes'];
    const changed = diffKeys.some(k => (existing as any)[k] !== (parsed as any)[k]);

    if (!changed) return { kind: 'unchanged', data: existing };

    const { data, error } = await supabase
      .from('signals')
      .update({ ...parsed, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select()
      .single();
    if (error) throw error;

    await sendTelegram(`Updated trade: ${data.side} ${data.asset} ` +
      (data.entry_price ? `@ ${data.entry_price}` : '') +
      (data.target_price ? ` | Target ${data.target_price}` : ''));

    await supabase.from('audit_logs').insert([{
      scope: 'SHEET',
      action: 'UPDATE_SIGNAL',
      ref_id: data.id,
      details: { before: existing, after: data },
    }]);

    return { kind: 'updated', data };
  }
}

async function fetchSheetCsv(): Promise<string> {
  // Build a robust CSV export URL: https://docs.google.com/spreadsheets/d/{id}/export?format=csv&gid={gid}
  const idMatch = SHEET_URL.match(/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  const gidMatch = SHEET_URL.match(/(?:[?&]gid=|#gid=)(\d+)/);
  const spreadsheetId = idMatch?.[1];
  const gid = gidMatch?.[1];

  let url = SHEET_URL;
  if (spreadsheetId) {
    url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv` + (gid ? `&gid=${gid}` : '');
  } else if (!SHEET_URL.includes('/export')) {
    // Fallback to naive replacement if we couldn't parse ID
    url = SHEET_URL.replace('/edit', '/export');
    url += SHEET_URL.includes('?') ? '&format=csv' : '?format=csv';
  }

  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Sheet fetch failed ${resp.status}`);
  }
  return await resp.text();
}

serve(async () => {
  try {
    const csv = await fetchSheetCsv();
    const rows = csvToRows(csv);
    if (rows.length < 2) return new Response(JSON.stringify({ ok: true, processed: 0 }), { headers: { 'content-type': 'application/json' } });

    // Find the header row that contains our trade table (must include 'Asset' and 'Type')
    let headerIndex = -1;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i].map(r => r.toLowerCase());
      if (row.includes('asset') && row.includes('type') && row.includes('price at trade')) {
        headerIndex = i;
        break;
      }
    }
    if (headerIndex === -1) {
      return new Response(JSON.stringify({ ok: true, processed: 0, reason: 'header_not_found' }), { headers: { 'content-type': 'application/json' } });
    }

    const header = rows[headerIndex];
    const dataRows = rows.slice(headerIndex + 1).filter(r => r.some(c => c && c.length));

    let processed = 0;
    for (const r of dataRows) {
      const parsed = parseRow(header, r);
      if (!parsed.asset) continue;
      // Avoid alert spam for very old trades (> 30 days) by temporarily skipping alerts
      const res = await upsertSignal(parsed);
      if (res.kind !== 'unchanged') processed += 1;
    }

    return new Response(JSON.stringify({ ok: true, processed, tab: SHEET_TAB }), { headers: { 'content-type': 'application/json' } });
  } catch (e) {
    await supabase.from('audit_logs').insert([{
      scope: 'SHEET',
      action: 'ERROR',
      details: { error: String(e) },
    }]);
    try { await sendTelegram(`Sheet monitor error: ${String(e)}`); } catch {}
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: { 'content-type': 'application/json' } });
  }
});


