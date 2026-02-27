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
    keyframes: {
      spin: {
        from: { transform: 'rotate(0deg)' },
        to: { transform: 'rotate(360deg)' },
      },
    },
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
    recipes: {
      button: {
        className: 'btn',
        base: {
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '2',
          fontWeight: 'medium',
          borderRadius: 'md',
          cursor: 'pointer',
          border: 'none',
          transition: 'all 0.15s ease',
          _disabled: {
            opacity: 0.5,
            cursor: 'not-allowed',
          },
        },
        variants: {
          variant: {
            solid: {
              bg: 'primary',
              color: 'primary.fg',
              _hover: { bg: 'primary.hover' },
            },
            outline: {
              bg: 'transparent',
              color: 'primary',
              border: '1px solid',
              borderColor: 'primary',
              _hover: { bg: 'bg.subtle' },
            },
            ghost: {
              bg: 'transparent',
              color: 'fg',
              _hover: { bg: 'bg.muted' },
            },
            danger: {
              bg: 'danger',
              color: 'white',
              _hover: { opacity: 0.9 },
            },
          },
          size: {
            sm: { px: '3', py: '1', fontSize: 'sm' },
            md: { px: '4', py: '2', fontSize: 'sm' },
            lg: { px: '6', py: '3', fontSize: 'md' },
          },
        },
        defaultVariants: {
          variant: 'solid',
          size: 'md',
        },
      },
      badge: {
        className: 'badge',
        base: {
          display: 'inline-flex',
          alignItems: 'center',
          px: '2',
          py: '0.5',
          borderRadius: 'full',
          fontSize: 'xs',
          fontWeight: 'medium',
          lineHeight: '1',
          whiteSpace: 'nowrap',
        },
        variants: {
          variant: {
            default: { bg: 'bg.muted', color: 'fg.muted' },
            blue:    { bg: 'blue.100', color: 'blue.500' },
            green:   { bg: 'green.100', color: 'green.500' },
            purple:  { bg: 'purple.100', color: 'purple.500' },
            teal:    { bg: 'teal.100', color: 'teal.500' },
            amber:   { bg: 'amber.100', color: 'amber.500' },
            red:     { bg: 'red.100', color: 'red.500' },
            slate:   { bg: 'slate.100', color: 'slate.500' },
          },
        },
        defaultVariants: {
          variant: 'default',
        },
      },
      input: {
        className: 'input',
        base: {
          display: 'block',
          w: 'full',
          px: '3',
          py: '2',
          fontSize: 'sm',
          borderRadius: 'md',
          border: '1px solid',
          borderColor: 'border',
          bg: 'bg',
          color: 'fg',
          outline: 'none',
          transition: 'border-color 0.15s ease',
          _focus: {
            borderColor: 'primary',
          },
          _placeholder: {
            color: 'fg.subtle',
          },
        },
        variants: {
          size: {
            sm: { px: '2', py: '1', fontSize: 'xs' },
            md: { px: '3', py: '2', fontSize: 'sm' },
            lg: { px: '4', py: '3', fontSize: 'md' },
          },
        },
        defaultVariants: {
          size: 'md',
        },
      },
    },
  },
})
