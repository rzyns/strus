import { createContext, useContext, type Component } from 'solid-js'

type Recipe = {
  (props?: Record<string, unknown>): Record<string, string>
  splitVariantProps: (props: Record<string, unknown>) => [Record<string, unknown>, Record<string, unknown>]
}

type Slot<R extends Recipe> = keyof ReturnType<R>

export function createStyleContext<R extends Recipe>(recipe: R) {
  const StyleContext = createContext<Record<string, string>>({})

  function withProvider<T extends Component<any>>(
    BaseComponent: T,
    slot: Slot<R>,
  ) {
    return (props: Record<string, any>) => {
      const [variantProps, otherProps] = recipe.splitVariantProps(props)
      const slotStyles = recipe(variantProps)
      const slotClass = slotStyles[slot as string] ?? ''
      const existing = otherProps.class ?? ''
      const combined = `${slotClass} ${existing}`.trim()

      return (
        <StyleContext.Provider value={slotStyles}>
          {/* @ts-ignore - Dynamic component typing */}
          <BaseComponent {...otherProps} class={combined} />
        </StyleContext.Provider>
      )
    }
  }

  function withRootProvider<T extends Component<any>>(
    BaseComponent: T,
    options?: { defaultProps?: () => Record<string, unknown> },
  ) {
    return (props: Record<string, any>) => {
      const merged = options?.defaultProps ? { ...options.defaultProps(), ...props } : props
      const [variantProps, otherProps] = recipe.splitVariantProps(merged)
      const slotStyles = recipe(variantProps)

      return (
        <StyleContext.Provider value={slotStyles}>
          {/* @ts-ignore - Dynamic component typing */}
          <BaseComponent {...otherProps} />
        </StyleContext.Provider>
      )
    }
  }

  function withContext<T extends Component<any>>(BaseComponent: T, slot: Slot<R>) {
    return (props: Record<string, any>) => {
      const slotStyles = useContext(StyleContext)
      const slotClass = slotStyles[slot as string] ?? ''
      const existing = props.class ?? ''
      const combined = `${slotClass} ${existing}`.trim()

      return (
        // @ts-ignore - Dynamic component typing
        <BaseComponent {...props} class={combined} />
      )
    }
  }

  return { withProvider, withRootProvider, withContext }
}
