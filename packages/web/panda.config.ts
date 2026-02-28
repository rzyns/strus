import { defineConfig } from '@pandacss/dev'
import { recipes, slotRecipes } from '~/theme/recipes'
import { conditions } from '~/theme/conditions'
import { globalCss } from '~/theme/global-css'
import { keyframes } from '~/theme/keyframes'
import { layerStyles } from '~/theme/layer-styles'
import { textStyles } from '~/theme/text-styles'
import { colors } from '~/theme/tokens/colors'
import { durations } from '~/theme/tokens/durations'
import { shadows } from '~/theme/tokens/shadows'
import { zIndex } from '~/theme/tokens/z-index'
import { animationStyles } from '~/theme/animation-styles'
import { neutral } from '~/theme/colors/neutral'
import { blue } from '~/theme/colors/blue'
import { red } from '~/theme/colors/red'
import { green } from '~/theme/colors/green'

export default defineConfig({
  preflight: true,
  include: ['./src/**/*.{ts,tsx}'],
  outdir: 'styled-system',
  jsxFramework: 'solid',

  conditions,

  globalCss: {
    ...globalCss,
    extend: {
      ...globalCss.extend,
      html: {
        ...globalCss.extend.html,
        boxSizing: 'border-box',
      },
      '*, *::before, *::after': {
        boxSizing: 'inherit',
      },
      body: {
        ...globalCss.extend.body,
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
        lineHeight: 1.6,
        margin: 0,
      },
    },
  },

  theme: {
    extend: {
      animationStyles,
      recipes,
      slotRecipes,
      keyframes,
      layerStyles,
      textStyles,
      tokens: {
        colors,
        durations,
        zIndex,
      },
      semanticTokens: {
        colors: {
          // Park UI core semantic tokens
          gray: neutral,
          colorPalette: blue,
          blue,
          red,
          green,
          fg: {
            default: { value: { _light: '{colors.gray.12}', _dark: '{colors.gray.12}' } },
            muted: { value: { _light: '{colors.gray.11}', _dark: '{colors.gray.11}' } },
            subtle: { value: { _light: '{colors.gray.10}', _dark: '{colors.gray.10}' } },
          },
          border: { value: { _light: '{colors.gray.4}', _dark: '{colors.gray.4}' } },
          error: { value: { _light: '{colors.red.9}', _dark: '{colors.red.9}' } },
          // Canvas token used by Park UI globalCss
          canvas: {
            DEFAULT: { value: { _light: '{colors.white}', _dark: '#0a0a0a' } },
          },
          // Legacy compatibility aliases for route files
          bg: {
            DEFAULT: { value: { _light: '{colors.white}', _dark: '#0a0a0a' } },
            subtle: { value: { _light: '{colors.gray.2}', _dark: '{colors.gray.2}' } },
            muted: { value: { _light: '{colors.gray.3}', _dark: '{colors.gray.3}' } },
          },
          primary: {
            DEFAULT: { value: { _light: '{colors.blue.9}', _dark: '{colors.blue.9}' } },
            hover: { value: { _light: '{colors.blue.10}', _dark: '{colors.blue.10}' } },
            fg: { value: { _light: '{colors.white}', _dark: '{colors.black}' } },
          },
          danger: {
            DEFAULT: { value: { _light: '{colors.red.9}', _dark: '{colors.red.9}' } },
          },
        },
        shadows,
        radii: {
          l1: { value: '{radii.xs}' },
          l2: { value: '{radii.sm}' },
          l3: { value: '{radii.md}' },
        },
      },
    },
  },
})
