// Selective launch sniper for the pump.fun bonding-curve replay.
//
// What the dev data and the kit's research sim showed:
//   - Chasing momentum on mature curves loses (my v1: -2.67 SOL; kit momentum pilot: -9.49).
//   - Riding high-reserve curves to big multiples loses once the 2-slot fill latency and
//     our own price impact are modelled (my v2 rider: -1.71 SOL on grade-local).
//   - Buying every launch loses too (kit sniper pilot: -0.47 SOL) — but requiring real
//     early interest flips it: coins that attract at least 6 distinct non-creator buyers
//     in their first 3 slots, with the creator not selling, are the only launches worth
//     touching. On the dev window that filter is the difference between -0.14 and +0.02.
// So this bot buys only those launches, tiny (the 1%-of-real-reserve cap binds at this
// age anyway), and gets out fast: +15% take-profit, -12% stop, 10 slots max, or the
// moment the creator sells. A round trip pays ~1.25% curve fee each way plus 105k
// lamports of tx fees per order, so the fast +15%/-12% shape with a 10-slot hold is
// what keeps fee drag below the edge the filter finds.
//
// Nothing here looks ahead: every decision uses only trades the harness has already
// delivered (orders fill 2 slots after the decision). No clock, no environment, no
// randomness — iteration only over insertion-ordered maps fed by the batch stream, so
// the two graded executions agree.
//
// Pure function of the batches it is fed; main.ts only hands it to runBot.

import type { Batch, BotState, OrderInput, Pubkey } from './vendor/makefun-bot.ts';

export interface Params {
  /** Youngest age (slots since create) at which a coin may be bought. */
  minAge: number;
  /** Oldest age at which a first buy may still be decided. */
  maxAge: number;
  /** SOL to aim for per coin in total (each reply is still capped at 1% of real SOL). */
  stakeSol: number;
  /** Smallest single buy worth paying the tx fee for (SOL). */
  minBuySol: number;
  /** Real SOL reserve window at decision time (SOL). */
  minRealSol: number;
  maxRealSol: number;
  /** Creator's own buys in the create slot: at most this (SOL). */
  maxDevBuySol: number;
  /** Distinct non-creator buyers seen before entry, at least this. */
  minBuyers: number;
  /** Creator sold before entry: skip the coin. */
  skipDevSold: boolean;
  /** Slippage allowed on buys (bps). */
  buySlipBps: number;
  /** Exit when the position is worth this much over its cost (fraction). */
  takeProfit: number;
  /** Exit when it is worth this much under its cost (fraction). */
  stopLoss: number;
  /** Exit after holding this many slots. */
  maxHold: number;
  /** Exit when the creator sells while held. */
  exitOnDevSell: boolean;
}

export const DEFAULT_PARAMS: Params = {
  minAge: 0,
  maxAge: 3,
  stakeSol: 0.3,
  minBuySol: 0.005,
  minRealSol: 0.3,
  maxRealSol: 30,
  maxDevBuySol: 2.5,
  minBuyers: 6,
  skipDevSold: true,
  buySlipBps: 10_000,
  takeProfit: 0.15,
  stopLoss: 0.12,
  maxHold: 10,
  exitOnDevSell: true,
};

const LAMPORTS = 1e9;
const CURVE_FEE = 0.0125; // protocol 95bps + creator 30bps, charged on each side
const SELL_SLIP_BPS = 10_000; // sells go out wide so exits never stall on slippage

interface Coin {
  creator: Pubkey;
  createdSlot: number;
  devBuySol: number;
  devSold: boolean;
  buyers: Set<Pubkey>;
  /** Decided: bought, filtered out for good, or too old to enter. */
  done: boolean;
  complete: boolean;
}

interface Held {
  openedSlot: number;
  /** Tx fees paid on this position's buys (added to the cost basis). */
  txPaidLamports: bigint;
}

/** What selling `tokens` against (vq, vt) would pay after curve fees. */
function sellValue(tokens: bigint, vq: bigint, vt: bigint): bigint {
  if (tokens <= 0n || vt <= 0n) return 0n;
  const q = (tokens * vq) / (vt + tokens);
  return q - (q * 125n + 9_999n) / 10_000n;
}

export function createStrategy(p: Params = DEFAULT_PARAMS) {
  const coins = new Map<Pubkey, Coin>();
  const held = new Map<Pubkey, Held>();
  /** Mints with a sell in flight. */
  const selling = new Set<Pubkey>();

  return {
    onBatch(state: BotState, batch: Batch): OrderInput[] {
      // Read the batch's events into the per-coin books.
      for (const e of batch.events) {
        if (e.event === 'CreateEvent') {
          coins.set(e.mint, {
            creator: e.creator,
            createdSlot: e.slot,
            devBuySol: 0,
            devSold: false,
            buyers: new Set(),
            done: false,
            complete: false,
          });
        } else if (e.event === 'TradeEvent') {
          const c = coins.get(e.mint);
          if (c === undefined) continue;
          const isDev = e.user === c.creator;
          if (e.is_buy) {
            if (isDev && e.slot === c.createdSlot) c.devBuySol += Number(e.sol_amount) / LAMPORTS;
            else if (!isDev) c.buyers.add(e.user);
          } else if (isDev) {
            c.devSold = true;
          }
        } else {
          const c = coins.get(e.mint);
          if (c !== undefined) {
            c.complete = true;
            c.done = true;
          }
        }
      }

      const orders: OrderInput[] = [];
      const cap = state.hello.caps.max_orders_per_batch;
      const tx = state.txFeeLamports();
      const marks = new Map(batch.marks.map((m) => [m.mint, m] as const));

      // Fold the fills: open held entries, track tx paid, clear finished sells,
      // and un-decide coins whose opening buy never landed.
      for (const f of batch.fills) {
        if (f.client_id.startsWith('_')) {
          held.delete(f.mint);
          selling.delete(f.mint);
          continue;
        }
        const h = held.get(f.mint);
        if (h !== undefined && f.status !== 'rejected') h.txPaidLamports += BigInt(f.tx_fee_lamports);
        if (f.side === 'buy' && f.status === 'filled' && h === undefined) {
          held.set(f.mint, { openedSlot: f.slot, txPaidLamports: BigInt(f.tx_fee_lamports) });
        }
        if (f.side === 'sell') selling.delete(f.mint);
        if (f.side === 'buy' && f.status !== 'filled' && !state.positions.has(f.mint)) {
          // The opening buy never filled: the coin may be tried again while young.
          let stillPending = false;
          for (const po of state.pending.values()) if (po.order.mint === f.mint) stillPending = true;
          if (!stillPending) {
            const c = coins.get(f.mint);
            if (c !== undefined) c.done = false;
          }
        }
      }
      for (const mint of [...selling]) {
        let pending = false;
        for (const po of state.pending.values()) if (po.order.mint === mint && po.order.side === 'sell') pending = true;
        if (!pending) selling.delete(mint);
      }
      for (const mint of [...held.keys()]) {
        if (!state.positions.has(mint) && !selling.has(mint)) {
          let pendingBuy = false;
          for (const po of state.pending.values()) if (po.order.mint === mint && po.order.side === 'buy') pendingBuy = true;
          if (!pendingBuy) held.delete(mint);
        }
      }

      // 1. Exits first.
      for (const [mint, pos] of state.positions) {
        if (orders.length >= cap) break;
        if (selling.has(mint)) continue;
        const c = coins.get(mint);
        let h = held.get(mint);
        if (h === undefined) {
          h = { openedSlot: state.slot, txPaidLamports: tx };
          held.set(mint, h);
        }
        const mk = marks.get(mint);
        let vq: bigint;
        let vt: bigint;
        if (mk !== undefined) {
          vq = BigInt(mk.virtual_quote_reserves);
          vt = BigInt(mk.virtual_token_reserves);
        } else {
          const cv = state.curves.get(mint);
          if (cv === undefined) continue;
          vq = cv.virtual_quote_reserves;
          vt = cv.virtual_token_reserves;
        }
        const value = sellValue(pos.token_amount, vq, vt) - tx;
        const basis = pos.cost_lamports + h.txPaidLamports;
        let exit = false;
        if (basis > 0n) {
          if (value * 10_000n >= basis * BigInt(Math.round((1 + p.takeProfit) * 10_000))) exit = true;
          if (value * 10_000n <= basis * BigInt(Math.round((1 - p.stopLoss) * 10_000))) exit = true;
        }
        if (state.slot - h.openedSlot >= p.maxHold) exit = true;
        if (p.exitOnDevSell && c !== undefined && c.devSold) exit = true;
        if (!exit) continue;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: SELL_SLIP_BPS });
        selling.add(mint);
        if (c !== undefined) c.done = true;
      }

      // 2. Entries: young launches with broad early buying and a clean creator.
      let free = state.freeCashLamports();
      let open = state.committedPositionCount();
      for (const [mint, c] of coins) {
        if (orders.length >= cap) break;
        if (c.done || c.complete) continue;
        const age = state.slot - c.createdSlot;
        if (age > p.maxAge) {
          c.done = true;
          continue;
        }
        if (age < p.minAge) continue;
        if (open >= state.hello.caps.max_open_positions) break;
        if (state.positions.has(mint)) continue;
        let pending = false;
        for (const po of state.pending.values()) if (po.order.mint === mint) pending = true;
        if (pending) continue;
        const curve = state.curves.get(mint);
        if (curve === undefined || curve.complete) continue;
        if (c.devSold && p.skipDevSold) {
          c.done = true;
          continue;
        }
        if (c.buyers.size < p.minBuyers) continue;
        if (c.devBuySol > p.maxDevBuySol) {
          c.done = true;
          continue;
        }
        const rqSol = Number(curve.real_quote_reserves) / LAMPORTS;
        if (rqSol < p.minRealSol || rqSol > p.maxRealSol) continue;
        const capLamports = (state.maxBuyLamports(mint) * 97n) / 100n;
        const stakeLamports = BigInt(Math.floor(p.stakeSol * LAMPORTS));
        const amount = capLamports < stakeLamports ? capLamports : stakeLamports;
        if (amount < BigInt(Math.floor(p.minBuySol * LAMPORTS))) continue;
        if (free < amount + tx) continue;
        orders.push({ side: 'buy', mint, quote_lamports: amount, max_slippage_bps: p.buySlipBps });
        free -= amount + tx;
        c.done = true;
        open += 1;
      }
      return orders;
    },
  };
}
