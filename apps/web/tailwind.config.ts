import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './features/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: { DEFAULT: '1rem', sm: '1.5rem', lg: '2rem' },
      screens: { '2xl': '1440px' },
    },
    extend: {
      fontFamily: {
        sans: [
          'var(--font-sans, ui-sans-serif)',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'SF Pro Display',
          'Inter',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
        mono: ['JetBrains Mono', 'Menlo', 'monospace'],
      },
      colors: {
        background: 'hsl(var(--bg) / <alpha-value>)',
        foreground: 'hsl(var(--fg) / <alpha-value>)',
        muted: {
          DEFAULT: 'hsl(var(--muted) / <alpha-value>)',
          foreground: 'hsl(var(--muted-fg) / <alpha-value>)',
        },
        surface: {
          DEFAULT: 'hsl(var(--surface) / <alpha-value>)',
          raised: 'hsl(var(--surface-raised) / <alpha-value>)',
          sunken: 'hsl(var(--surface-sunken) / <alpha-value>)',
        },
        border: 'hsl(var(--border) / <alpha-value>)',
        ring: 'hsl(var(--ring) / <alpha-value>)',
        accent: {
          DEFAULT: 'hsl(var(--accent) / <alpha-value>)',
          foreground: 'hsl(var(--accent-fg) / <alpha-value>)',
        },
        bull: 'hsl(var(--bull) / <alpha-value>)',
        bear: 'hsl(var(--bear) / <alpha-value>)',
        warn: 'hsl(var(--warn) / <alpha-value>)',
      },
      borderRadius: {
        // Skin-controllable: flat skins tighten these via --radius-* (globals.css);
        // fallbacks keep the classic look when a skin doesn't set them.
        sm: 'var(--radius-sm, 0.25rem)',
        DEFAULT: 'var(--radius, 0.375rem)',
        md: 'var(--radius-md, 0.5rem)',
        lg: 'var(--radius-lg, 0.75rem)',
        xl: 'var(--radius-xl, 1rem)',
      },
      boxShadow: {
        glass:
          'var(--panel-shadow, 0 1px 0 hsl(var(--border) / 0.6) inset, 0 12px 24px -16px rgba(0,0,0,0.55))',
        floating: '0 24px 48px -24px rgba(0,0,0,0.5), 0 4px 12px -4px rgba(0,0,0,0.25)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'fade-out': { from: { opacity: '1' }, to: { opacity: '0' } },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        // macOS-style centered dialog: a subtle scale + fade that keeps the element centred
        // (the translate(-50%,-50%) matches the resting -translate-x/y-1/2 classes).
        'dialog-in': {
          from: { opacity: '0', transform: 'translate(-50%, -50%) scale(0.96)' },
          to: { opacity: '1', transform: 'translate(-50%, -50%) scale(1)' },
        },
        'dialog-out': {
          from: { opacity: '1', transform: 'translate(-50%, -50%) scale(1)' },
          to: { opacity: '0', transform: 'translate(-50%, -50%) scale(0.96)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        pulseDot: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.35' },
        },
      },
      animation: {
        // macOS easing (smooth decel) + snappy durations.
        'fade-in': 'fade-in 150ms cubic-bezier(0.16, 1, 0.3, 1)',
        'fade-out': 'fade-out 120ms ease-in',
        'slide-up': 'slide-up 220ms cubic-bezier(0.16, 1, 0.3, 1)',
        'dialog-in': 'dialog-in 200ms cubic-bezier(0.16, 1, 0.3, 1)',
        'dialog-out': 'dialog-out 140ms ease-in',
        shimmer: 'shimmer 2s linear infinite',
        'pulse-dot': 'pulseDot 1.4s ease-in-out infinite',
      },
    },
  },
};

export default config;
