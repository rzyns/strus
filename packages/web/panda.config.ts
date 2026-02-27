import { defineConfig } from '@pandacss/dev'

export default defineConfig({
  preflight: true,
  include: ['./src/**/*.{ts,tsx}'],
  outdir: 'styled-system',

  conditions: {
    dark: '[data-theme="dark"] &',
  },

  globalCss: {
    html: {
      boxSizing: 'border-box',
    },
    '*, *::before, *::after': {
      boxSizing: 'inherit',
    },
    body: {
      fontFamily: 'system-ui, -apple-system, sans-serif',
      color: '{colors.fg}',
      bg: '{colors.bg}',
      lineHeight: 1.6,
      margin: 0,
    },
  },

  theme: {
    tokens: {
      colors: {
        // Brand palette — blue-grey hue 220, oklch
        brand: {
          50:  { value: 'oklch(0.97 0.01 220)' },
          100: { value: 'oklch(0.93 0.02 220)' },
          200: { value: 'oklch(0.86 0.04 220)' },
          300: { value: 'oklch(0.76 0.07 220)' },
          400: { value: 'oklch(0.66 0.10 220)' },
          500: { value: 'oklch(0.56 0.12 220)' },
          600: { value: 'oklch(0.48 0.12 220)' },
          700: { value: 'oklch(0.40 0.10 220)' },
          800: { value: 'oklch(0.32 0.08 220)' },
          900: { value: 'oklch(0.24 0.06 220)' },
        },
        // Neutral greys
        neutral: {
          0:   { value: '#ffffff' },
          50:  { value: 'oklch(0.98 0.00 0)' },
          100: { value: 'oklch(0.95 0.00 0)' },
          200: { value: 'oklch(0.90 0.00 0)' },
          300: { value: 'oklch(0.82 0.00 0)' },
          400: { value: 'oklch(0.70 0.00 0)' },
          500: { value: 'oklch(0.55 0.00 0)' },
          600: { value: 'oklch(0.45 0.00 0)' },
          700: { value: 'oklch(0.37 0.00 0)' },
          800: { value: 'oklch(0.25 0.00 0)' },
          900: { value: 'oklch(0.18 0.00 0)' },
          950: { value: 'oklch(0.12 0.00 0)' },
        },
        // Accent colours for badges etc.
        blue:   { 500: { value: 'oklch(0.55 0.15 240)' }, 100: { value: 'oklch(0.93 0.04 240)' } },
        green:  { 500: { value: 'oklch(0.55 0.15 145)' }, 100: { value: 'oklch(0.93 0.04 145)' } },
        purple: { 500: { value: 'oklch(0.55 0.15 300)' }, 100: { value: 'oklch(0.93 0.04 300)' } },
        teal:   { 500: { value: 'oklch(0.55 0.10 185)' }, 100: { value: 'oklch(0.93 0.03 185)' } },
        amber:  { 500: { value: 'oklch(0.70 0.15 75)' },  100: { value: 'oklch(0.95 0.04 75)' } },
        red:    { 500: { value: 'oklch(0.55 0.20 25)' },  100: { value: 'oklch(0.93 0.04 25)' } },
        slate:  { 500: { value: 'oklch(0.55 0.02 250)' }, 100: { value: 'oklch(0.93 0.01 250)' } },
      },
    },
    semanticTokens: {
      colors: {
        bg: {
          DEFAULT: { value: { base: '{colors.neutral.0}',   _dark: '{colors.neutral.950}' } },
          subtle:  { value: { base: '{colors.neutral.50}',  _dark: '{colors.neutral.900}' } },
          muted:   { value: { base: '{colors.neutral.100}', _dark: '{colors.neutral.800}' } },
        },
        fg: {
          DEFAULT: { value: { base: '{colors.neutral.900}', _dark: '{colors.neutral.50}' } },
          muted:   { value: { base: '{colors.neutral.600}', _dark: '{colors.neutral.400}' } },
          subtle:  { value: { base: '{colors.neutral.400}', _dark: '{colors.neutral.600}' } },
        },
        border: {
          DEFAULT: { value: { base: '{colors.neutral.200}', _dark: '{colors.neutral.800}' } },
          strong:  { value: { base: '{colors.neutral.300}', _dark: '{colors.neutral.700}' } },
        },
        primary: {
          DEFAULT: { value: { base: '{colors.brand.600}', _dark: '{colors.brand.400}' } },
          hover:   { value: { base: '{colors.brand.700}', _dark: '{colors.brand.300}' } },
          fg:      { value: { base: '{colors.neutral.0}', _dark: '{colors.neutral.950}' } },
        },
        danger: {
          DEFAULT: { value: { base: '{colors.red.500}', _dark: '{colors.red.500}' } },
        },
      },
    },
  },
})
