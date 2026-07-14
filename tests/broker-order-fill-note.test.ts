import { describe, expect, it } from 'vitest';
import {
  formatOrderFillNote,
  formatOrderRejectNote,
  buildAutomationNote,
  type AutomationNoteContext,
} from '../apps/api/src/broker/order-fill-note';

const ctx: AutomationNoteContext = {
  broker: 'kite',
  tradingSymbol: 'RELIANCE',
  exchange: 'NSE',
  side: 'buy',
  quantity: 10,
  product: 'mis',
};

describe('order-fill-note — GW-7 polish (b) Telegram fill notifications', () => {
  it('formatOrderFillNote: fresh open (flat → BUY) reads "Opened long" with instrument + qty + product + broker', () => {
    const t = formatOrderFillNote(ctx, 'open', ['OID1']);
    expect(t).toContain('Opened long');
    expect(t).toContain('NSE:RELIANCE');
    expect(t).toContain('BUY 10');
    expect(t).toContain('MIS');
    expect(t).toContain('Zerodha Kite');
    expect(t).toContain('OID1');
    expect(t).toContain('🟢');
  });

  it('formatOrderFillNote: a SELL flip reads "Flipped to short" with a red marker and both order ids', () => {
    const t = formatOrderFillNote({ ...ctx, side: 'sell', quantity: 5, product: 'nrml' }, 'flip', ['C1', 'O2']);
    expect(t).toContain('Flipped to short');
    expect(t).toContain('SELL 5');
    expect(t).toContain('NRML');
    expect(t).toContain('🔴');
    expect(t).toContain('C1');
    expect(t).toContain('O2');
  });

  it('formatOrderFillNote: includes an app link only when appUrl is provided', () => {
    expect(formatOrderFillNote(ctx, 'open', ['OID1'])).not.toContain('/terminal');
    const withLink = formatOrderFillNote({ ...ctx, appUrl: 'https://supercharting.com' }, 'open', ['OID1']);
    expect(withLink).toContain('https://supercharting.com/terminal');
  });

  it('formatOrderRejectNote: honest failure note carries the broker message verbatim (HTML-escaped)', () => {
    const t = formatOrderRejectNote(ctx, 'InputException: qty <bad> & wrong');
    expect(t).toContain('rejected');
    expect(t).toContain('NSE:RELIANCE');
    expect(t).toContain('BUY 10');
    // The message is escaped so a broker string with < > & can't break Telegram HTML parse mode.
    expect(t).toContain('InputException: qty &lt;bad&gt; &amp; wrong');
    expect(t).not.toContain('<bad>');
    expect(t).toContain('⚠️');
  });

  it('buildAutomationNote: placed → fill note; broker_rejected → reject note', () => {
    expect(buildAutomationNote({ status: 'placed', flip: 'flip', brokerOrderIds: ['C1', 'O2'] }, ctx)).toContain(
      'Flipped',
    );
    expect(
      buildAutomationNote({ status: 'error', reason: 'broker_rejected', message: 'boom' }, ctx),
    ).toContain('rejected');
  });

  it('buildAutomationNote: no note for money-did-not-move outcomes (noop / skipped / non-reject errors)', () => {
    expect(buildAutomationNote({ status: 'noop', reason: 'already_long' }, ctx)).toBeNull();
    expect(buildAutomationNote({ status: 'skipped', reason: 'kill_switch' }, ctx)).toBeNull();
    expect(buildAutomationNote({ status: 'skipped', reason: 'ip_not_whitelisted' }, ctx)).toBeNull();
    expect(buildAutomationNote({ status: 'error', reason: 'positions_failed', message: 'x' }, ctx)).toBeNull();
    expect(buildAutomationNote({ status: 'error', reason: 'executor_failed', message: 'x' }, ctx)).toBeNull();
  });
});
