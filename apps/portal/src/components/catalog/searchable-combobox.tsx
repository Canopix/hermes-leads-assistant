'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Check, ChevronsUpDown, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ComboboxOption {
  id: string | number
  label: string
}

interface SearchableComboboxProps {
  label: string
  value: string
  options: ComboboxOption[]
  onChange: (value: string, option: ComboboxOption | null) => void
  placeholder?: string
  disabled?: boolean
  required?: boolean
  loading?: boolean
  /** Allow values not in the list (custom / new cars). Default true. */
  allowCustom?: boolean
  emptyHint?: string
  helperText?: string
}

function normalize(s: string) {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

export function SearchableCombobox({
  label,
  value,
  options,
  onChange,
  placeholder = 'Buscar…',
  disabled = false,
  required = false,
  loading = false,
  allowCustom = true,
  emptyHint = 'Sin resultados',
  helperText,
}: SearchableComboboxProps) {
  const listId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState(value)

  useEffect(() => {
    setQuery(value)
  }, [value])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false)
        setQuery(value)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open, value])

  const filtered = useMemo(() => {
    const q = normalize(query)
    if (!q) return options.slice(0, 80)
    return options
      .filter((o) => normalize(o.label).includes(q))
      .slice(0, 80)
  }, [options, query])

  const exactMatch = useMemo(() => {
    const q = normalize(query)
    if (!q) return null
    return options.find((o) => normalize(o.label) === q) || null
  }, [options, query])

  const showCustom =
    allowCustom &&
    query.trim().length > 0 &&
    !exactMatch &&
    !filtered.some((o) => normalize(o.label) === normalize(query))

  const pick = (opt: ComboboxOption | null, raw: string) => {
    const next = opt ? opt.label : raw.trim()
    onChange(next, opt)
    setQuery(next)
    setOpen(false)
  }

  return (
    <div className="block space-y-1" ref={rootRef}>
      <span className="text-xs font-medium">{label}</span>
      <div className="relative">
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          required={required}
          disabled={disabled}
          placeholder={loading ? 'Cargando…' : placeholder}
          className={cn(
            'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 pr-9 text-sm',
            'ring-offset-background placeholder:text-muted-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            'disabled:cursor-not-allowed disabled:opacity-50'
          )}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // Commit typed custom value on blur if allowed
            if (!allowCustom) return
            const t = query.trim()
            if (t && t !== value) {
              const match = options.find((o) => normalize(o.label) === normalize(t))
              onChange(match ? match.label : t, match || null)
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setOpen(false)
              setQuery(value)
            }
            if (e.key === 'Enter') {
              e.preventDefault()
              if (exactMatch) pick(exactMatch, exactMatch.label)
              else if (filtered[0]) pick(filtered[0], filtered[0].label)
              else if (allowCustom && query.trim()) pick(null, query)
            }
          }}
        />
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 text-muted-foreground hover:text-foreground"
          onClick={() => setOpen((o) => !o)}
          aria-label="Abrir lista"
        >
          <ChevronsUpDown className="h-4 w-4" />
        </button>

        {open && !disabled && (
          <ul
            id={listId}
            role="listbox"
            className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-popover text-popover-foreground shadow-md"
          >
            {loading && (
              <li className="px-3 py-2 text-sm text-muted-foreground">Cargando…</li>
            )}
            {!loading && filtered.length === 0 && !showCustom && (
              <li className="px-3 py-2 text-sm text-muted-foreground">{emptyHint}</li>
            )}
            {!loading &&
              filtered.map((opt) => {
                const selected = normalize(opt.label) === normalize(value)
                return (
                  <li key={`${opt.id}-${opt.label}`} role="option" aria-selected={selected}>
                    <button
                      type="button"
                      className={cn(
                        'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent',
                        selected && 'bg-accent/60'
                      )}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pick(opt, opt.label)}
                    >
                      <Check
                        className={cn(
                          'h-3.5 w-3.5 shrink-0',
                          selected ? 'opacity-100' : 'opacity-0'
                        )}
                      />
                      <span className="truncate">{opt.label}</span>
                    </button>
                  </li>
                )
              })}
            {showCustom && (
              <li role="option">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 border-t px-3 py-2 text-left text-sm hover:bg-accent"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(null, query)}
                >
                  <Plus className="h-3.5 w-3.5 shrink-0 text-primary" />
                  <span>
                    Usar <strong>«{query.trim()}»</strong> (nuevo)
                  </span>
                </button>
              </li>
            )}
          </ul>
        )}
      </div>
      {helperText ? (
        <p className="text-[11px] text-muted-foreground leading-snug">{helperText}</p>
      ) : null}
    </div>
  )
}
