'use client';

import { create } from 'zustand';

export interface ToastItem {
  id: string;
  title: string;
  description?: string;
  tone?: 'default' | 'success' | 'error' | 'warn';
  durationMs?: number;
}

interface ToastStore {
  items: ToastItem[];
  push: (t: Omit<ToastItem, 'id'>) => string;
  dismiss: (id: string) => void;
}

export const useToastStore = create<ToastStore>((set) => ({
  items: [],
  push: (t) => {
    const id = `t_${Math.random().toString(36).slice(2, 10)}`;
    const item: ToastItem = { tone: 'default', durationMs: 3200, ...t, id };
    set((s) => ({ items: [...s.items, item] }));
    if (typeof window !== 'undefined') {
      setTimeout(() => {
        set((s) => ({ items: s.items.filter((i) => i.id !== id) }));
      }, item.durationMs);
    }
    return id;
  },
  dismiss: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
}));

export function toast(input: Omit<ToastItem, 'id'>): string {
  return useToastStore.getState().push(input);
}
