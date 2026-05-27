export type Plan = 'free' | 'pro_6m' | 'pro_12m';

export type SubscriptionStatus =
  | 'none'
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'incomplete';

export interface PlanPricing {
  plan: Plan;
  label: string;
  priceCents: number;
  currency: 'USD';
  intervalLabel: string;
  features: string[];
  popular?: boolean;
}

export const PLANS: readonly PlanPricing[] = [
  {
    plan: 'pro_6m',
    label: 'Pro 6M',
    priceCents: 40000,
    currency: 'USD',
    intervalLabel: '6 months',
    features: [
      'Live crypto + forex',
      'Volume profile + footprint',
      'Liquidity heatmap',
      'Deep-trade bubbles',
      'Unlimited drawings & layouts',
      'News overlay + alerts',
      'Replay mode',
      '4 / 8 / 16 window grid',
    ],
  },
  {
    plan: 'pro_12m',
    label: 'Pro Annual',
    priceCents: 60000,
    currency: 'USD',
    intervalLabel: '12 months',
    popular: true,
    features: [
      'Everything in Pro 6M',
      'Best value — save vs. 6M',
      'Priority data routing',
      'Extended historical depth',
      'Early access to new features',
    ],
  },
] as const;

export interface SubscriptionRecord {
  id: string;
  userId: string;
  plan: Plan;
  status: SubscriptionStatus;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  currentPeriodEnd?: number;
  cancelAtPeriodEnd: boolean;
}

export interface BillingCheckoutRequest {
  plan: 'pro_6m' | 'pro_12m';
  successUrl: string;
  cancelUrl: string;
}

export interface BillingCheckoutResponse {
  url: string | null;
  status: 'ok' | 'not_configured';
  message?: string;
}
