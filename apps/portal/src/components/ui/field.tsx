import * as React from 'react'

interface FieldProps {
  label: string
  /** Texto de ayuda que aparece arriba del input. */
  hint?: string
  /** Para inputs requeridos, muestra un asterisco al lado del label. */
  required?: boolean
  children: React.ReactNode
}

/**
 * Etiqueta + ayuda + control. Sirve para dar contexto al usuario en formularios
 * de configuración. No envuelve el input en sí, solo el label y la ayuda;
 * el input/textarea/select se pasa como children.
 */
export function Field({ label, hint, required, children }: FieldProps) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </span>
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      {children}
    </label>
  )
}

/** Clase de input estandarizada para reutilizar en toda la config. */
export const inputCls =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring'
