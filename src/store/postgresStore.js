const { Pool } = require('pg');
const config = require('../config');
const fileData = require('./fileData');

const { DATA_DIR, getCatalogBundle, getPromocodes, ordersToCsv } = fileData;

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : false,
  max: 8,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

function normalizeIdentity(identity = {}) {
  const tg = identity.telegramUser || identity;
  return {
    telegramId: tg?.id ? String(tg.id) : '',
    firstName: String(tg?.first_name || identity.firstName || '').trim(),
    lastName: String(tg?.last_name || identity.lastName || '').trim(),
    username: String(tg?.username || identity.username || '').trim(),
    phone: String(identity.phone || '').trim()
  };
}

function rowToCustomer(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    publicId: row.public_id,
    telegramId: row.telegram_id || '',
    firstName: row.first_name || '',
    lastName: row.last_name || '',
    username: row.username || '',
    phone: row.phone || '',
    bonusBalance: Number(row.bonus_balance || 0),
    lifetimeSpend: Number(row.lifetime_spend || 0),
    completedOrders: Number(row.completed_orders || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToOrder(row) {
  if (!row) return null;
  const data = row.data || {};
  return {
    ...data,
    id: row.id,
    status: row.status,
    customerDbId: row.customer_id ? String(row.customer_id) : (data.customerDbId || ''),
    customerPublicId: row.customer_public_id || data.customerPublicId || '',
    total: Number(row.total ?? data.total ?? 0),
    cashTotal: Number(row.cash_total ?? data.cashTotal ?? row.total ?? 0),
    bonusesUsed: Number(row.bonuses_used ?? data.bonusesUsed ?? 0),
    bonusesEarnedPotential: Number(row.bonuses_earned_potential ?? data.bonusesEarnedPotential ?? 0),
    bonusesEarned: Number(row.bonuses_earned ?? data.bonusesEarned ?? 0),
    bonusCredited: Boolean(row.bonus_credited ?? data.bonusCredited),
    bonusRefunded: Boolean(row.bonus_refunded ?? data.bonusRefunded),
    createdAt: row.created_at || data.createdAt,
    updatedAt: row.updated_at || data.updatedAt
  };
}

async function init() {
  await pool.query(`
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
    create index if not exists deli_orders_manager_message_idx on deli_orders((data->>'managerMessageId'));

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
  `);
  return { mode: 'postgres', persistent: true };
}

async function getSettings() {
  const result = await pool.query(`select value from deli_settings where key = 'runtime'`);
  return result.rows[0]?.value || {};
}

async function updateSettings(patch) {
  const current = await getSettings();
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await pool.query(`
    insert into deli_settings(key, value, updated_at)
    values ('runtime', $1::jsonb, now())
    on conflict (key) do update set value = excluded.value, updated_at = now()
  `, [JSON.stringify(next)]);
  return next;
}

async function _getOrCreateCustomer(client, identity = {}, lock = false) {
  const n = normalizeIdentity(identity);
  if (!n.telegramId && !n.phone) return null;
  const conditions = [];
  const values = [];
  if (n.telegramId) { values.push(n.telegramId); conditions.push(`telegram_id = $${values.length}`); }
  if (n.phone) { values.push(n.phone); conditions.push(`phone = $${values.length}`); }
  let query = `select * from deli_customers where ${conditions.join(' or ')} limit 1`;
  if (lock) query += ' for update';
  let result = await client.query(query, values);
  let row = result.rows[0];
  if (!row) {
    result = await client.query(`
      insert into deli_customers(telegram_id, first_name, last_name, username, phone)
      values ($1, $2, $3, $4, $5)
      returning *
    `, [n.telegramId || null, n.firstName, n.lastName, n.username, n.phone]);
    row = result.rows[0];
    const publicId = `DB-${String(row.id).padStart(6, '0')}`;
    result = await client.query(`update deli_customers set public_id=$1, updated_at=now() where id=$2 returning *`, [publicId, row.id]);
    row = result.rows[0];
  } else {
    result = await client.query(`
      update deli_customers set
        telegram_id = coalesce(nullif($1,''), telegram_id),
        first_name = coalesce(nullif($2,''), first_name),
        last_name = coalesce(nullif($3,''), last_name),
        username = coalesce(nullif($4,''), username),
        phone = coalesce(nullif($5,''), phone),
        updated_at = now()
      where id = $6 returning *
    `, [n.telegramId, n.firstName, n.lastName, n.username, n.phone, row.id]);
    row = result.rows[0];
  }
  return rowToCustomer(row);
}

async function getOrCreateCustomer(identity = {}) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const customer = await _getOrCreateCustomer(client, identity, true);
    await client.query('commit');
    return customer;
  } catch (error) {
    await client.query('rollback').catch(() => null);
    throw error;
  } finally {
    client.release();
  }
}

async function createOrderWithCustomer(order, identity, bonusRequested = 0, rules = {}) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const customer = await _getOrCreateCustomer(client, { ...identity, phone: order.customer?.phone || identity?.phone || '' }, true);
    const requested = Math.max(0, Math.floor(Number(bonusRequested || 0)));
    const maxByOrder = Math.max(0, Math.floor(Number(order.total || 0) * Number(rules.maxRedeemPercent || 0) / 100));
    const bonusesUsed = customer && rules.enabled !== false
      ? Math.min(requested, Number(customer.bonusBalance || 0), maxByOrder)
      : 0;
    let updatedCustomer = customer;
    if (customer && bonusesUsed > 0) {
      const customerResult = await client.query(`
        update deli_customers set bonus_balance = bonus_balance - $1, updated_at=now()
        where id=$2 and bonus_balance >= $1 returning *
      `, [bonusesUsed, customer.id]);
      if (!customerResult.rows[0]) throw new Error('Недостаточно бонусов. Обновите профиль и повторите заказ.');
      updatedCustomer = rowToCustomer(customerResult.rows[0]);
      await client.query(`
        insert into deli_bonus_transactions(customer_id, customer_public_id, order_id, type, amount, balance_after, note)
        values($1,$2,$3,'redeem',$4,$5,$6)
        on conflict do nothing
      `, [customer.id, customer.publicId, order.id, -bonusesUsed, updatedCustomer.bonusBalance, 'Бонусы зарезервированы для заказа']);
    }
    const cashTotal = Math.max(0, Number(order.total || 0) - bonusesUsed);
    const potential = rules.enabled === false ? 0 : Math.max(0, Math.round(cashTotal * Number(rules.earnPercent || 0) / 100));
    const enriched = {
      ...order,
      customerDbId: updatedCustomer?.id || '',
      customerPublicId: updatedCustomer?.publicId || '',
      bonusBalanceBefore: updatedCustomer ? updatedCustomer.bonusBalance + bonusesUsed : 0,
      bonusBalanceAfterReservation: updatedCustomer?.bonusBalance || 0,
      bonusRequested: requested,
      bonusesUsed,
      cashTotal,
      bonusesEarnedPotential: potential,
      bonusesEarned: 0,
      bonusCredited: false,
      bonusRefunded: false
    };
    await client.query(`
      insert into deli_orders(
        id, customer_id, customer_public_id, telegram_id, status, total, cash_total,
        bonuses_used, bonuses_earned_potential, data, created_at, updated_at
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12)
    `, [
      enriched.id,
      updatedCustomer?.id || null,
      updatedCustomer?.publicId || '',
      String(enriched.telegramUser?.id || ''),
      enriched.status,
      enriched.total,
      enriched.cashTotal,
      enriched.bonusesUsed,
      enriched.bonusesEarnedPotential,
      JSON.stringify(enriched),
      enriched.createdAt,
      enriched.updatedAt
    ]);
    await client.query('commit');
    return { order: enriched, customer: updatedCustomer };
  } catch (error) {
    await client.query('rollback').catch(() => null);
    throw error;
  } finally {
    client.release();
  }
}

async function addOrder(order) {
  const result = await createOrderWithCustomer(order, { telegramUser: order.telegramUser, phone: order.customer?.phone }, 0, { enabled: false });
  return result.order;
}

async function listOrders() {
  const result = await pool.query(`select * from deli_orders order by created_at desc`);
  return result.rows.map(rowToOrder);
}

async function getOrder(orderId) {
  const result = await pool.query(`select * from deli_orders where id=$1`, [orderId]);
  return rowToOrder(result.rows[0]);
}

async function updateOrder(orderId, patch) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await client.query(`select * from deli_orders where id=$1 for update`, [orderId]);
    const current = rowToOrder(result.rows[0]);
    if (!current) { await client.query('rollback'); return null; }
    const updated = { ...current, ...patch, updatedAt: new Date().toISOString() };
    const saved = await client.query(`
      update deli_orders set status=$2, total=$3, cash_total=$4, bonuses_used=$5,
        bonuses_earned_potential=$6, bonuses_earned=$7, bonus_credited=$8,
        bonus_refunded=$9, data=$10::jsonb, updated_at=now()
      where id=$1 returning *
    `, [
      orderId, updated.status, updated.total || 0, updated.cashTotal ?? updated.total ?? 0,
      updated.bonusesUsed || 0, updated.bonusesEarnedPotential || 0, updated.bonusesEarned || 0,
      Boolean(updated.bonusCredited), Boolean(updated.bonusRefunded), JSON.stringify(updated)
    ]);
    await client.query('commit');
    return rowToOrder(saved.rows[0]);
  } catch (error) {
    await client.query('rollback').catch(() => null);
    throw error;
  } finally {
    client.release();
  }
}

async function transitionOrderStatus(orderId, status, actor = {}, rules = {}) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await client.query(`select * from deli_orders where id=$1 for update`, [orderId]);
    let order = rowToOrder(result.rows[0]);
    if (!order) { await client.query('rollback'); return null; }
    const history = Array.isArray(order.statusHistory) ? order.statusHistory : [];
    order = {
      ...order,
      status,
      statusHistory: [...history, { status, at: new Date().toISOString(), actor }],
      updatedAt: new Date().toISOString()
    };
    if (status === 'paid' && !order.paidAt) order.paidAt = new Date().toISOString();

    if (status === 'canceled' && order.bonusesUsed > 0 && !order.bonusRefunded && order.customerDbId) {
      const customerResult = await client.query(`
        update deli_customers set bonus_balance=bonus_balance+$1, updated_at=now()
        where id=$2 returning *
      `, [order.bonusesUsed, order.customerDbId]);
      const customer = rowToCustomer(customerResult.rows[0]);
      if (customer) {
        await client.query(`
          insert into deli_bonus_transactions(customer_id, customer_public_id, order_id, type, amount, balance_after, note)
          values($1,$2,$3,'refund',$4,$5,$6) on conflict do nothing
        `, [customer.id, customer.publicId, order.id, order.bonusesUsed, customer.bonusBalance, 'Возврат бонусов после отмены заказа']);
        order.bonusRefunded = true;
        order.bonusBalanceAfter = customer.bonusBalance;
      }
    }

    if (status === 'done' && !order.bonusCredited && order.customerDbId && rules.enabled !== false) {
      const earned = Math.max(0, Number(order.bonusesEarnedPotential || Math.round(Number(order.cashTotal || order.total || 0) * Number(rules.earnPercent || 0) / 100)));
      const customerResult = await client.query(`
        update deli_customers set bonus_balance=bonus_balance+$1,
          lifetime_spend=lifetime_spend+$2, completed_orders=completed_orders+1, updated_at=now()
        where id=$3 returning *
      `, [earned, Number(order.total || 0), order.customerDbId]);
      const customer = rowToCustomer(customerResult.rows[0]);
      if (customer) {
        if (earned > 0) {
          await client.query(`
            insert into deli_bonus_transactions(customer_id, customer_public_id, order_id, type, amount, balance_after, note)
            values($1,$2,$3,'earn',$4,$5,$6) on conflict do nothing
          `, [customer.id, customer.publicId, order.id, earned, customer.bonusBalance, `Начисление ${Number(rules.earnPercent || 0)}% за завершённый заказ`]);
        }
        order.bonusesEarned = earned;
        order.bonusCredited = true;
        order.bonusBalanceAfter = customer.bonusBalance;
      }
    }

    const saved = await client.query(`
      update deli_orders set status=$2, bonuses_earned=$3, bonus_credited=$4,
        bonus_refunded=$5, data=$6::jsonb, updated_at=now()
      where id=$1 returning *
    `, [order.id, order.status, order.bonusesEarned || 0, Boolean(order.bonusCredited), Boolean(order.bonusRefunded), JSON.stringify(order)]);
    await client.query('commit');
    return rowToOrder(saved.rows[0]);
  } catch (error) {
    await client.query('rollback').catch(() => null);
    throw error;
  } finally {
    client.release();
  }
}

async function updateOrderStatus(orderId, status, actor = {}) {
  return transitionOrderStatus(orderId, status, actor, { enabled: false, earnPercent: 0 });
}

async function getCustomerProfile(identity = {}) {
  const customer = await getOrCreateCustomer(identity);
  if (!customer) return null;
  const [transactionsResult, ordersResult] = await Promise.all([
    pool.query(`select * from deli_bonus_transactions where customer_id=$1 order by created_at desc limit 30`, [customer.id]),
    pool.query(`select * from deli_orders where customer_id=$1 order by created_at desc limit 15`, [customer.id])
  ]);
  return {
    customer,
    transactions: transactionsResult.rows.map((row) => ({
      id: String(row.id),
      customerId: String(row.customer_id),
      customerPublicId: row.customer_public_id,
      orderId: row.order_id,
      type: row.type,
      amount: Number(row.amount || 0),
      balanceAfter: Number(row.balance_after || 0),
      note: row.note,
      createdAt: row.created_at
    })),
    orders: ordersResult.rows.map(rowToOrder)
  };
}

async function listCustomers() {
  const result = await pool.query(`select * from deli_customers order by updated_at desc`);
  return result.rows.map(rowToCustomer);
}

async function adjustCustomerBonus(publicId, amount, note = 'Ручная корректировка') {
  const delta = Math.trunc(Number(amount || 0));
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await client.query(`select * from deli_customers where public_id=$1 for update`, [publicId]);
    const current = rowToCustomer(result.rows[0]);
    if (!current) { await client.query('rollback'); return null; }
    const nextBalance = Math.max(0, current.bonusBalance + delta);
    const actualDelta = nextBalance - current.bonusBalance;
    const update = await client.query(`update deli_customers set bonus_balance=$1, updated_at=now() where id=$2 returning *`, [nextBalance, current.id]);
    const customer = rowToCustomer(update.rows[0]);
    await client.query(`
      insert into deli_bonus_transactions(customer_id, customer_public_id, type, amount, balance_after, note)
      values($1,$2,'manual',$3,$4,$5)
    `, [customer.id, customer.publicId, actualDelta, customer.bonusBalance, note]);
    await client.query('commit');
    return customer;
  } catch (error) {
    await client.query('rollback').catch(() => null);
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  mode: 'postgres',
  persistent: true,
  DATA_DIR,
  init,
  getSettings,
  updateSettings,
  getCatalogBundle,
  getPromocodes,
  listOrders,
  addOrder,
  createOrderWithCustomer,
  getOrder,
  updateOrder,
  updateOrderStatus,
  transitionOrderStatus,
  getOrCreateCustomer,
  getCustomerProfile,
  listCustomers,
  adjustCustomerBonus,
  ordersToCsv,
  pool
};
