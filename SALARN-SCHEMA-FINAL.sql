-- ============================================================
-- Salarn — Crypto Copy-Trading Platform
-- Supabase Schema (PostgreSQL) — v3 PRODUCTION FINAL
-- ============================================================
-- Run this entire file in the Supabase SQL Editor to set up
-- the full database for a fresh Salarn deployment.
-- Idempotent: safe to re-run; nothing drops existing data.
-- ============================================================

-- Enable required extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";


-- ============================================================
-- SHARED TRIGGER FUNCTION
-- set search_path = '' prevents search_path injection (Supabase lint 0011)
-- ============================================================
create or replace function public.update_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- ============================================================
-- AUTO-CREATE USER PROFILE ON AUTH SIGNUP
-- This trigger fires on auth.users INSERT (server-side, bypasses RLS)
-- and creates the public.users row + initial user_balances row
-- automatically — no client-side insert needed.
-- This also fixes the {} signup error caused by RLS blocking
-- client-side inserts before the session is fully established.
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Insert user profile (idempotent — skip on conflict)
  insert into public.users (auth_id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', null),
    'user'
  )
  on conflict (auth_id) do nothing;

  -- Insert initial balance row
  insert into public.user_balances (user_email, balance_usd, total_invested, total_profit_loss)
  values (new.email, 0, 0, 0)
  on conflict (user_email) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ============================================================
-- 1. USERS
-- ============================================================
create table if not exists public.users (
  id             uuid primary key default uuid_generate_v4(),
  auth_id        uuid unique references auth.users(id) on delete cascade,
  email          text unique not null,
  full_name      text,
  role           text not null default 'user' check (role in ('user', 'admin')),
  wallet_address text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

drop trigger if exists users_updated_at on public.users;
create trigger users_updated_at
  before update on public.users
  for each row execute function public.update_updated_at();

create index if not exists users_auth_id_idx on public.users(auth_id);
create index if not exists users_email_idx    on public.users(email);


-- ============================================================
-- 2. USER BALANCES
-- ============================================================
create table if not exists public.user_balances (
  id                 uuid primary key default uuid_generate_v4(),
  user_email         text unique not null references public.users(email) on delete cascade,
  balance_usd        numeric(20,8) not null default 0 check (balance_usd >= 0),
  total_invested     numeric(20,8) not null default 0,
  total_profit_loss  numeric(20,8) not null default 0,
  updated_at         timestamptz not null default now()
);

drop trigger if exists user_balances_updated_at on public.user_balances;
create trigger user_balances_updated_at
  before update on public.user_balances
  for each row execute function public.update_updated_at();

create index if not exists user_balances_email_idx on public.user_balances(user_email);


-- ============================================================
-- 3. CRYPTOCURRENCIES
-- Column names match the application TypeScript code exactly.
-- ============================================================
create table if not exists public.cryptocurrencies (
  id            uuid primary key default uuid_generate_v4(),
  symbol        text unique not null,
  name          text not null,
  price         numeric(20,8) not null default 0,
  change_24h    numeric(10,4) default 0,
  market_cap    numeric(30,2) default 0,
  volume_24h    numeric(30,2) default 0,
  icon_color    text default '#6366f1',
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

drop trigger if exists cryptocurrencies_updated_at on public.cryptocurrencies;
create trigger cryptocurrencies_updated_at
  before update on public.cryptocurrencies
  for each row execute function public.update_updated_at();

create index if not exists cryptos_active_idx on public.cryptocurrencies(is_active, market_cap desc);

-- Seed default coins (idempotent)
insert into public.cryptocurrencies (symbol, name, price, change_24h, market_cap, volume_24h, icon_color) values
  ('BTC',  'Bitcoin',      67420.00,  3.14,  1320000000000, 42000000000, '#F7931A'),
  ('ETH',  'Ethereum',      3892.00,  2.87,   468000000000, 18000000000, '#627EEA'),
  ('SOL',  'Solana',         178.50,  5.23,    82000000000,  3200000000, '#9945FF'),
  ('BNB',  'BNB',            612.00, -0.82,    91000000000,  2100000000, '#F3BA2F'),
  ('DOGE', 'Dogecoin',         0.0412, 8.91,   5800000000,   900000000, '#C2A633'),
  ('ADA',  'Cardano',          0.622, -1.44,  22000000000,   650000000, '#0033AD'),
  ('AVAX', 'Avalanche',       39.80,  4.12,   16000000000,   720000000, '#E84142'),
  ('DOT',  'Polkadot',         8.90,  1.77,   11000000000,   380000000, '#E6007A'),
  ('MATIC','Polygon',          0.92,  2.34,    9200000000,   540000000, '#8247E5'),
  ('LINK', 'Chainlink',       18.40,  3.87,   10800000000,   480000000, '#2A5ADA'),
  ('XRP',  'XRP',              0.52,  1.05,   27000000000,  1200000000, '#00AAE4'),
  ('UNI',  'Uniswap',          7.80,  2.11,    5900000000,   240000000, '#FF007A'),
  ('ATOM', 'Cosmos',           8.40, -0.73,    3200000000,   180000000, '#2E3148'),
  ('LTC',  'Litecoin',        84.00,  0.92,    6200000000,   420000000, '#BFBBBB'),
  ('SHIB', 'Shiba Inu',      0.000022, 4.56,  13000000000,   850000000, '#E01F24')
on conflict (symbol) do nothing;


-- ============================================================
-- 4. PORTFOLIO
-- Uses crypto_symbol text (not FK) for flexibility.
-- ============================================================
create table if not exists public.portfolio (
  id            uuid primary key default uuid_generate_v4(),
  user_email    text not null references public.users(email) on delete cascade,
  crypto_symbol text not null,
  amount        numeric(30,8) not null default 0 check (amount >= 0),
  avg_buy_price numeric(20,8) not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_email, crypto_symbol)
);

drop trigger if exists portfolio_updated_at on public.portfolio;
create trigger portfolio_updated_at
  before update on public.portfolio
  for each row execute function public.update_updated_at();

create index if not exists portfolio_user_email_idx on public.portfolio(user_email);


-- ============================================================
-- 5. TRANSACTIONS
-- ============================================================
create table if not exists public.transactions (
  id             uuid primary key default uuid_generate_v4(),
  user_email     text not null references public.users(email) on delete cascade,
  type           text not null check (type in ('deposit','withdrawal','buy','sell','copy_profit')),
  amount         numeric(20,8) not null check (amount > 0),
  crypto_symbol  text,
  crypto_amount  numeric(30,8),
  status         text not null default 'pending' check (status in ('pending','approved','rejected','completed')),
  notes          text,
  wallet_address text,
  otp_code       text,
  otp_verified   boolean not null default false,
  otp_expires_at timestamptz,
  reviewed_by    text,
  reviewed_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

drop trigger if exists transactions_updated_at on public.transactions;
create trigger transactions_updated_at
  before update on public.transactions
  for each row execute function public.update_updated_at();

create index if not exists transactions_user_email_idx on public.transactions(user_email);
create index if not exists transactions_created_at_idx on public.transactions(created_at desc);
create index if not exists transactions_status_idx     on public.transactions(status);
create index if not exists transactions_type_idx       on public.transactions(type);


-- ============================================================
-- 6. COPY TRADERS
-- Column names match the application TypeScript code exactly.
-- ============================================================
create table if not exists public.copy_traders (
  id                 uuid primary key default uuid_generate_v4(),
  trader_name        text          not null,
  specialty          text,
  total_profit_pct   numeric(10,2) not null default 0,
  monthly_profit_pct numeric(10,2) not null default 0,
  win_rate           numeric(5,2)  not null default 0,
  total_trades       integer       not null default 0,
  followers          integer       not null default 0,
  profit_split_pct   numeric(5,2)  not null default 20,
  min_allocation     numeric(20,2) not null default 100,
  is_approved        boolean       not null default false,
  is_active          boolean       not null default true,
  risk_level         text          not null default 'medium' check (risk_level in ('low','medium','high')),
  avatar_color       text                   default '#6366f1',
  created_at         timestamptz   not null default now(),
  updated_at         timestamptz   not null default now()
);

drop trigger if exists copy_traders_updated_at on public.copy_traders;
create trigger copy_traders_updated_at
  before update on public.copy_traders
  for each row execute function public.update_updated_at();

create index if not exists copy_traders_approved_idx on public.copy_traders(is_approved, total_profit_pct desc);

-- Seed default traders (idempotent via name uniqueness workaround)
insert into public.copy_traders
  (trader_name, specialty, total_profit_pct, monthly_profit_pct, win_rate, total_trades, followers, profit_split_pct, min_allocation, is_approved, is_active, risk_level, avatar_color)
select * from (values
  ('Alex Chen',    'DeFi Expert', 248.0, 18.2, 78.0, 1240, 3200, 20.0, 100.0, true, true, 'medium', '#10b981'),
  ('Sarah Kim',    'BTC Maxi',    184.0, 14.8, 82.0,  980, 2100, 15.0, 200.0, true, true, 'low',    '#3b82f6'),
  ('Marcus Obi',   'Alt Season',  312.0, 24.1, 71.0, 1580, 4800, 25.0,  50.0, true, true, 'high',   '#a855f7'),
  ('Priya Sharma', 'Swing Trade', 156.0, 11.3, 74.0,  720, 1450, 20.0, 150.0, true, true, 'medium', '#f59e0b'),
  ('Jake Williams','Scalper',     422.0, 31.7, 67.0, 3200, 6100, 30.0,  25.0, true, true, 'high',   '#ef4444')
) as v(trader_name, specialty, total_profit_pct, monthly_profit_pct, win_rate, total_trades, followers, profit_split_pct, min_allocation, is_approved, is_active, risk_level, avatar_color)
where not exists (
  select 1 from public.copy_traders where trader_name = v.trader_name
);


-- ============================================================
-- 7. COPY TRADES
-- ============================================================
create table if not exists public.copy_trades (
  id              uuid          primary key default uuid_generate_v4(),
  user_email      text          not null references public.users(email) on delete cascade,
  trader_id       uuid          not null references public.copy_traders(id) on delete cascade,
  trader_name     text          not null,
  allocation      numeric(20,2) not null check (allocation > 0),
  profit_loss     numeric(20,2) not null default 0,
  profit_loss_pct numeric(10,4) not null default 0,
  is_active       boolean       not null default true,
  created_at      timestamptz   not null default now(),
  updated_at      timestamptz   not null default now()
);

drop trigger if exists copy_trades_updated_at on public.copy_trades;
create trigger copy_trades_updated_at
  before update on public.copy_trades
  for each row execute function public.update_updated_at();

create index if not exists copy_trades_user_email_idx on public.copy_trades(user_email);
create index if not exists copy_trades_active_idx     on public.copy_trades(user_email, is_active);
create index if not exists copy_trades_trader_idx     on public.copy_trades(trader_id);


-- ============================================================
-- 8. PLATFORM SETTINGS
-- Key-value store for admin-configurable settings.
-- ============================================================
create table if not exists public.platform_settings (
  id         uuid        primary key default uuid_generate_v4(),
  key        text        unique not null,
  value      text,
  label      text,
  updated_by text,
  updated_at timestamptz not null default now()
);

-- Seed default settings (idempotent)
insert into public.platform_settings (key, value, label) values
  ('deposit_address_btc',        '',               'Bitcoin (BTC) Address'),
  ('deposit_address_eth',        '',               'Ethereum (ETH) Address'),
  ('deposit_address_usdt_trc20', '',               'USDT TRC20 Address'),
  ('deposit_address_usdt_erc20', '',               'USDT ERC20 Address'),
  ('deposit_address_bnb',        '',               'BNB Address'),
  ('trading_fee_pct',            '0.5',            'Trading Fee (%)'),
  ('withdrawal_fee_pct',         '1.0',            'Withdrawal Fee (%)'),
  ('min_deposit_usd',            '50',             'Minimum Deposit (USD)'),
  ('min_withdrawal_usd',         '20',             'Minimum Withdrawal (USD)'),
  ('platform_name',              'Salarn',         'Platform Name'),
  ('support_email',              'support@salarn.com', 'Support Email'),
  ('telegram_support',           '@SalarnSupport', 'Telegram Support')
on conflict (key) do nothing;


-- ============================================================
-- ROW LEVEL SECURITY
-- All tables use RLS. Admin check via subquery is safe because
-- auth.uid() is evaluated first (index on auth_id).
-- ============================================================


-- ── USERS ────────────────────────────────────────────────────
alter table public.users enable row level security;

drop policy if exists "users: select own or admin" on public.users;
create policy "users: select own or admin"
  on public.users for select
  using (
    auth_id = auth.uid()
    or (select role from public.users where auth_id = auth.uid() limit 1) = 'admin'
  );

drop policy if exists "users: insert own" on public.users;
create policy "users: insert own"
  on public.users for insert
  with check (auth_id = auth.uid());

drop policy if exists "users: update own or admin" on public.users;
create policy "users: update own or admin"
  on public.users for update
  using (
    auth_id = auth.uid()
    or (select role from public.users where auth_id = auth.uid() limit 1) = 'admin'
  )
  with check (
    auth_id = auth.uid()
    or (select role from public.users where auth_id = auth.uid() limit 1) = 'admin'
  );


-- ── USER BALANCES ────────────────────────────────────────────
alter table public.user_balances enable row level security;

drop policy if exists "balances: select own or admin" on public.user_balances;
create policy "balances: select own or admin"
  on public.user_balances for select
  using (
    user_email = (select email from public.users where auth_id = auth.uid() limit 1)
    or (select role from public.users where auth_id = auth.uid() limit 1) = 'admin'
  );

drop policy if exists "balances: insert own or admin" on public.user_balances;
create policy "balances: insert own or admin"
  on public.user_balances for insert
  with check (
    user_email = (select email from public.users where auth_id = auth.uid() limit 1)
    or (select role from public.users where auth_id = auth.uid() limit 1) = 'admin'
  );

drop policy if exists "balances: update own or admin" on public.user_balances;
create policy "balances: update own or admin"
  on public.user_balances for update
  using (
    user_email = (select email from public.users where auth_id = auth.uid() limit 1)
    or (select role from public.users where auth_id = auth.uid() limit 1) = 'admin'
  )
  with check (
    user_email = (select email from public.users where auth_id = auth.uid() limit 1)
    or (select role from public.users where auth_id = auth.uid() limit 1) = 'admin'
  );


-- ── CRYPTOCURRENCIES ─────────────────────────────────────────
alter table public.cryptocurrencies enable row level security;

-- Any authenticated user can read active coins; admin reads all
drop policy if exists "cryptos: select" on public.cryptocurrencies;
create policy "cryptos: select"
  on public.cryptocurrencies for select
  using (
    is_active = true
    or (select role from public.users where auth_id = auth.uid() limit 1) = 'admin'
  );

drop policy if exists "cryptos: admin insert" on public.cryptocurrencies;
create policy "cryptos: admin insert"
  on public.cryptocurrencies for insert
  with check ((select role from public.users where auth_id = auth.uid() limit 1) = 'admin');

drop policy if exists "cryptos: admin update" on public.cryptocurrencies;
create policy "cryptos: admin update"
  on public.cryptocurrencies for update
  using  ((select role from public.users where auth_id = auth.uid() limit 1) = 'admin')
  with check ((select role from public.users where auth_id = auth.uid() limit 1) = 'admin');

drop policy if exists "cryptos: admin delete" on public.cryptocurrencies;
create policy "cryptos: admin delete"
  on public.cryptocurrencies for delete
  using  ((select role from public.users where auth_id = auth.uid() limit 1) = 'admin');


-- ── PORTFOLIO ────────────────────────────────────────────────
alter table public.portfolio enable row level security;

drop policy if exists "portfolio: select own or admin" on public.portfolio;
create policy "portfolio: select own or admin"
  on public.portfolio for select
  using (
    user_email = (select email from public.users where auth_id = auth.uid() limit 1)
    or (select role from public.users where auth_id = auth.uid() limit 1) = 'admin'
  );

drop policy if exists "portfolio: insert own or admin" on public.portfolio;
create policy "portfolio: insert own or admin"
  on public.portfolio for insert
  with check (
    user_email = (select email from public.users where auth_id = auth.uid() limit 1)
    or (select role from public.users where auth_id = auth.uid() limit 1) = 'admin'
  );

drop policy if exists "portfolio: update own or admin" on public.portfolio;
create policy "portfolio: update own or admin"
  on public.portfolio for update
  using (
    user_email = (select email from public.users where auth_id = auth.uid() limit 1)
    or (select role from public.users where auth_id = auth.uid() limit 1) = 'admin'
  )
  with check (
    user_email = (select email from public.users where auth_id = auth.uid() limit 1)
    or (select role from public.users where auth_id = auth.uid() limit 1) = 'admin'
  );

drop policy if exists "portfolio: delete own or admin" on public.portfolio;
create policy "portfolio: delete own or admin"
  on public.portfolio for delete
  using (
    user_email = (select email from public.users where auth_id = auth.uid() limit 1)
    or (select role from public.users where auth_id = auth.uid() limit 1) = 'admin'
  );


-- ── TRANSACTIONS ─────────────────────────────────────────────
alter table public.transactions enable row level security;

drop policy if exists "transactions: select own or admin" on public.transactions;
create policy "transactions: select own or admin"
  on public.transactions for select
  using (
    user_email = (select email from public.users where auth_id = auth.uid() limit 1)
    or (select role from public.users where auth_id = auth.uid() limit 1) = 'admin'
  );

drop policy if exists "transactions: insert own or admin" on public.transactions;
create policy "transactions: insert own or admin"
  on public.transactions for insert
  with check (
    user_email = (select email from public.users where auth_id = auth.uid() limit 1)
    or (select role from public.users where auth_id = auth.uid() limit 1) = 'admin'
  );

drop policy if exists "transactions: update own or admin" on public.transactions;
create policy "transactions: update own or admin"
  on public.transactions for update
  using (
    user_email = (select email from public.users where auth_id = auth.uid() limit 1)
    or (select role from public.users where auth_id = auth.uid() limit 1) = 'admin'
  )
  with check (
    user_email = (select email from public.users where auth_id = auth.uid() limit 1)
    or (select role from public.users where auth_id = auth.uid() limit 1) = 'admin'
  );


-- ── COPY TRADERS ─────────────────────────────────────────────
alter table public.copy_traders enable row level security;

-- Authenticated users see approved+active traders; admins see all
drop policy if exists "copy_traders: select" on public.copy_traders;
create policy "copy_traders: select"
  on public.copy_traders for select
  using (
    (is_approved = true and is_active = true)
    or (select role from public.users where auth_id = auth.uid() limit 1) = 'admin'
  );

drop policy if exists "copy_traders: admin insert" on public.copy_traders;
create policy "copy_traders: admin insert"
  on public.copy_traders for insert
  with check ((select role from public.users where auth_id = auth.uid() limit 1) = 'admin');

drop policy if exists "copy_traders: admin update" on public.copy_traders;
create policy "copy_traders: admin update"
  on public.copy_traders for update
  using  ((select role from public.users where auth_id = auth.uid() limit 1) = 'admin')
  with check ((select role from public.users where auth_id = auth.uid() limit 1) = 'admin');

drop policy if exists "copy_traders: admin delete" on public.copy_traders;
create policy "copy_traders: admin delete"
  on public.copy_traders for delete
  using  ((select role from public.users where auth_id = auth.uid() limit 1) = 'admin');


-- ── COPY TRADES ──────────────────────────────────────────────
alter table public.copy_trades enable row level security;

drop policy if exists "copy_trades: select own or admin" on public.copy_trades;
create policy "copy_trades: select own or admin"
  on public.copy_trades for select
  using (
    user_email = (select email from public.users where auth_id = auth.uid() limit 1)
    or (select role from public.users where auth_id = auth.uid() limit 1) = 'admin'
  );

drop policy if exists "copy_trades: insert own or admin" on public.copy_trades;
create policy "copy_trades: insert own or admin"
  on public.copy_trades for insert
  with check (
    user_email = (select email from public.users where auth_id = auth.uid() limit 1)
    or (select role from public.users where auth_id = auth.uid() limit 1) = 'admin'
  );

drop policy if exists "copy_trades: update own or admin" on public.copy_trades;
create policy "copy_trades: update own or admin"
  on public.copy_trades for update
  using (
    user_email = (select email from public.users where auth_id = auth.uid() limit 1)
    or (select role from public.users where auth_id = auth.uid() limit 1) = 'admin'
  )
  with check (
    user_email = (select email from public.users where auth_id = auth.uid() limit 1)
    or (select role from public.users where auth_id = auth.uid() limit 1) = 'admin'
  );

drop policy if exists "copy_trades: delete own or admin" on public.copy_trades;
create policy "copy_trades: delete own or admin"
  on public.copy_trades for delete
  using (
    user_email = (select email from public.users where auth_id = auth.uid() limit 1)
    or (select role from public.users where auth_id = auth.uid() limit 1) = 'admin'
  );


-- ── PLATFORM SETTINGS ────────────────────────────────────────
alter table public.platform_settings enable row level security;

-- Any authenticated user can read (needed for deposit addresses on Transactions page)
drop policy if exists "settings: authenticated read" on public.platform_settings;
create policy "settings: authenticated read"
  on public.platform_settings for select
  using (auth.uid() is not null);

-- Only admins can write
drop policy if exists "settings: admin insert" on public.platform_settings;
create policy "settings: admin insert"
  on public.platform_settings for insert
  with check ((select role from public.users where auth_id = auth.uid() limit 1) = 'admin');

drop policy if exists "settings: admin update" on public.platform_settings;
create policy "settings: admin update"
  on public.platform_settings for update
  using  ((select role from public.users where auth_id = auth.uid() limit 1) = 'admin')
  with check ((select role from public.users where auth_id = auth.uid() limit 1) = 'admin');

drop policy if exists "settings: admin delete" on public.platform_settings;
create policy "settings: admin delete"
  on public.platform_settings for delete
  using  ((select role from public.users where auth_id = auth.uid() limit 1) = 'admin');


-- ============================================================
-- REALTIME (enable for live dashboard updates)
-- Uncomment the lines below to enable real-time subscriptions.
-- ============================================================
-- alter publication supabase_realtime add table public.transactions;
-- alter publication supabase_realtime add table public.user_balances;
-- alter publication supabase_realtime add table public.portfolio;
-- alter publication supabase_realtime add table public.copy_trades;


-- ============================================================
-- DONE
-- ============================================================
-- Next steps:
--   1. Run this file in Supabase SQL Editor (SQL Editor tab)
--   2. Configure Auth → URL Configuration:
--        Site URL:     https://your-vercel-domain.vercel.app
--        Redirect URLs: https://your-vercel-domain.vercel.app/auth/callback
--   3. In Vercel project, set environment variables:
--        VITE_SUPABASE_URL     = https://arhmuhqglzrsdkdfmpyy.supabase.co
--        VITE_SUPABASE_ANON_KEY = eyJhbGciOi...
--   4. After first signup, promote yourself to admin:
--        UPDATE public.users SET role = 'admin' WHERE email = 'your@email.com';
-- ============================================================
