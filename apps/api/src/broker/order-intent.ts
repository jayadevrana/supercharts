import { z } from 'zod';
import type { OrderIntent } from './types';

/**
 * Order-intent validation for the BYOB trading routes (GW-3). Pure + tested so the wire
 * contract the UI depends on is pinned independently of Fastify. The broker still has the
 * final say — any residual rejection (margin, freeze qty, circuit) is surfaced verbatim —
 * but obviously-malformed tickets (a limit with no price, an SL with no trigger, a
 * fractional/zero quantity) are refused BEFORE we ever touch the broker or audit a request.
 */
export const orderIntentSchema = z
  .object({
    symbol: z.string().min(1).max(64),
    exchange: z.string().min(1).max(16),
    side: z.enum(['buy', 'sell']),
    quantity: z.number().int().positive(),
    orderType: z.enum(['market', 'limit', 'sl', 'sl-m']),
    product: z.enum(['mis', 'cnc', 'nrml']),
    price: z.number().positive().optional(),
    triggerPrice: z.number().positive().optional(),
    variety: z.enum(['regular', 'amo']).optional(),
    validity: z.enum(['day', 'ioc']).optional(),
  })
  .superRefine((v, ctx) => {
    // Kite requires a limit price for LIMIT and SL, and a trigger for SL and SL-M.
    if ((v.orderType === 'limit' || v.orderType === 'sl') && v.price === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['price'], message: 'price is required for limit and sl orders' });
    }
    if ((v.orderType === 'sl' || v.orderType === 'sl-m') && v.triggerPrice === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['triggerPrice'], message: 'triggerPrice is required for sl and sl-m orders' });
    }
  });

/** Partial changes accepted by PUT /orders/:id (modify). At least one field must be present. */
export const modifyChangesSchema = z
  .object({
    quantity: z.number().int().positive().optional(),
    price: z.number().positive().optional(),
    triggerPrice: z.number().positive().optional(),
    orderType: z.enum(['market', 'limit', 'sl', 'sl-m']).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'at least one field must change' });

export const varietySchema = z.enum(['regular', 'amo']);

export type ValidateResult =
  | { ok: true; intent: OrderIntent }
  | { ok: false; error: string };

export function validateOrderIntent(raw: unknown): ValidateResult {
  const parsed = orderIntentSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid order intent' };
  }
  return { ok: true, intent: parsed.data };
}
