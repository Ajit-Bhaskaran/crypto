-- Core schema for trade copier
-- settings: single-user configuration
create table if not exists settings (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  aud_base boolean not null default true,
  deploy_immediately boolean not null default true,
  latest_signal_first boolean not null default true,
  no_selling boolean not null default true
);

-- app_state: store cursors/checkpoints (e.g., last processed sheet hash)
create table if not exists app_state (
  key text primary key,
  value text not null,
  updated_at timestamptz default now()
);

-- signals: parsed rows from Google Sheet "Trades" tab
create table if not exists signals (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  trade_date date,
  asset text not null,
  base_currency text not null default 'AUD',
  side text not null,           -- BUY or SELL
  entry_price numeric,
  target_price numeric,
  stop_price numeric,
  weight numeric,
  notes text,
  status text,
  sheet_row_id text,
  unique(sheet_row_id)
);

-- orders: orders sent to the exchange
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  signal_id uuid references signals(id) on delete set null,
  asset text not null,
  base_currency text not null default 'AUD',
  side text not null,           -- BUY or SELL
  order_type text not null,     -- MARKET or LIMIT
  requested_qty numeric,
  requested_amount_aud numeric,
  requested_price numeric,
  status text not null,         -- PENDING, FILLED, PARTIAL, FAILED, CANCELLED
  provider_order_id text,
  provider text not null default 'SWYFTX',
  error text
);

-- positions: aggregate holdings
create table if not exists positions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  asset text not null,
  base_currency text not null default 'AUD',
  qty numeric not null default 0,
  avg_entry_price numeric,
  realized_pnl numeric not null default 0,
  unrealized_pnl numeric not null default 0,
  status text not null default 'OPEN'
);

-- audit_logs: detailed journal of actions
create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  scope text not null,     -- SHEET, ALERT, TRADE, EXEC, POSITION
  action text not null,    -- PARSED, NEW_SIGNAL, UPDATE_SIGNAL, ALERT_SENT, ORDER_SENT, ORDER_FILLED, ERROR
  ref_id text,
  details jsonb
);


