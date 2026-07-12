-- Deli Berry Production 1.0
-- Таблицы создаются приложением автоматически при первом запуске.

create table if not exists deli_customers (
  id bigserial primary key,
  public_id text unique,
  telegram_id text unique,
  first_name text not null default '',
  last_name text not null default '',
  username text not null default '',
  phone text not null default '',
  bonus_balance integer not null default 0 check (bonus_balance >= 0),
  lifetime_spend integer not null default 0 check (lifetime_spend >= 0),
  completed_orders integer not null default 0 check (completed_orders >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists deli_customers_phone_unique
  on deli_customers(phone) where phone <> '';

create table if not exists deli_orders (
  id text primary key,
  customer_id bigint references deli_customers(id) on delete set null,
  customer_public_id text not null default '',
  telegram_id text not null default '',
  status text not null default 'new',
  total integer not null default 0,
  cash_total integer not null default 0,
  bonuses_used integer not null default 0,
  bonuses_earned_potential integer not null default 0,
  bonuses_earned integer not null default 0,
  bonus_credited boolean not null default false,
  bonus_refunded boolean not null default false,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists deli_orders_customer_idx on deli_orders(customer_id, created_at desc);
create index if not exists deli_orders_status_idx on deli_orders(status, created_at desc);

create table if not exists deli_bonus_transactions (
  id bigserial primary key,
  customer_id bigint not null references deli_customers(id) on delete cascade,
  customer_public_id text not null,
  order_id text not null default '',
  type text not null,
  amount integer not null,
  balance_after integer not null,
  note text not null default '',
  created_at timestamptz not null default now()
);

create unique index if not exists deli_bonus_order_type_unique
  on deli_bonus_transactions(order_id, type) where order_id <> '';
create index if not exists deli_bonus_customer_idx on deli_bonus_transactions(customer_id, created_at desc);

create table if not exists deli_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
