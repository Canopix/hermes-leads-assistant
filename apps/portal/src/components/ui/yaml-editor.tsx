'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import yaml from 'js-yaml'

interface YamlEditorProps {
  value: string
  onChange: (value: string) => void
  readOnly?: boolean
  height?: string
}

interface YamlError {
  line: number
  message: string
}

export function YamlEditor({ value, onChange, readOnly = false, height = '500px' }: YamlEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const highlightRef = useRef<HTMLPreElement>(null)
  const [errors, setErrors] = useState<YamlError[]>([])
  const [cursorLine, setCursorLine] = useState(1)

  const validate = useCallback((text: string) => {
    try {
      yaml.load(text)
      setErrors([])
    } catch (e: any) {
      const mark = e.mark
      if (mark) {
        setErrors([{ line: mark.line + 1, message: e.reason || e.message }])
      } else {
        setErrors([{ line: 1, message: e.message || 'Invalid YAML' }])
      }
    }
  }, [])

  useEffect(() => {
    validate(value)
  }, [value, validate])

  const highlight = useCallback((text: string): string => {
    const lines = text.split('\n')
    return lines
      .map((line, i) => {
        const lineNum = i + 1
        const isError = errors.some((e) => e.line === lineNum)
        const isCurrentLine = lineNum === cursorLine

        let colored = escapeHtml(line)

        // Comment highlighting
        if (colored.trimStart().startsWith('#')) {
          colored = `<span class="text-muted-foreground italic">${colored}</span>`
        } else {
          // Key highlighting (key: value)
          colored = colored.replace(
            /^(\s*)([\w_-]+)(:)/,
            '$1<span class="text-blue-600 dark:text-blue-400 font-medium">$2</span><span class="text-muted-foreground">$3</span>'
          )

          // String value highlighting
          colored = colored.replace(
            /:\s*(".*?"|'.*?')/g,
            ': <span class="text-green-600 dark:text-green-400">$1</span>'
          )

          // Number highlighting
          colored = colored.replace(
            /:\s*(\d+\.?\d*)\s*$/g,
            ': <span class="text-amber-600 dark:text-amber-400">$1</span>'
          )

          // Boolean highlighting
          colored = colored.replace(
            /:\s*(true|false|yes|no|null)\s*$/gi,
            ': <span class="text-purple-600 dark:text-purple-400">$1</span>'
          )

          // List item highlighting
          colored = colored.replace(
            /^(\s*)(- )/,
            '$1<span class="text-muted-foreground">$2</span>'
          )
        }

        const errorClass = isError ? 'bg-red-500/10 border-l-2 border-red-500' : ''
        const currentClass = isCurrentLine && !isError ? 'bg-accent/50' : ''

        return `<div class="px-2 ${errorClass} ${currentClass} min-h-[1.5em] leading-relaxed">${colored || '&nbsp;'}</div>`
      })
      .join('')
  }, [errors, cursorLine])

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value)
  }

  const handleScroll = () => {
    if (textareaRef.current && highlightRef.current) {
      highlightRef.current.scrollTop = textareaRef.current.scrollTop
      highlightRef.current.scrollLeft = textareaRef.current.scrollLeft
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const textarea = e.currentTarget

    // Tab support
    if (e.key === 'Tab') {
      e.preventDefault()
      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const newValue = value.substring(0, start) + '  ' + value.substring(end)
      onChange(newValue)
      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 2
      }, 0)
    }
  }

  const handleSelect = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const textarea = e.currentTarget
    const textBefore = value.substring(0, textarea.selectionStart)
    const line = textBefore.split('\n').length
    setCursorLine(line)
  }

  const lineCount = value.split('\n').length

  return (
    <div className="border rounded-md overflow-hidden bg-background">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/50 text-xs">
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground">
            Linea {cursorLine} / {lineCount}
          </span>
          {errors.length > 0 ? (
            <span className="text-red-600 dark:text-red-400 flex items-center gap-1">
              <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              {errors[0].message}
            </span>
          ) : (
            <span className="text-green-600 dark:text-green-400 flex items-center gap-1">
              <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              YAML valido
            </span>
          )}
        </div>
      </div>

      {/* Editor */}
      <div className="relative" style={{ height }}>
        {/* Line numbers */}
        <div className="absolute left-0 top-0 bottom-0 w-12 bg-muted/30 border-r overflow-hidden select-none pointer-events-none">
          <div className="p-3 text-xs text-muted-foreground text-right font-mono leading-relaxed">
            {Array.from({ length: lineCount }, (_, i) => (
              <div key={i + 1} className={i + 1 === cursorLine ? 'text-foreground font-medium' : ''}>
                {i + 1}
              </div>
            ))}
          </div>
        </div>

        {/* Syntax highlight layer */}
        <pre
          ref={highlightRef}
          className="absolute inset-0 pl-14 pr-3 py-3 font-mono text-sm overflow-auto pointer-events-none whitespace-pre-wrap break-words"
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: highlight(value) }}
        />

        {/* Textarea (transparent text) */}
        <textarea
          ref={textareaRef}
          className="absolute inset-0 pl-14 pr-3 py-3 font-mono text-sm w-full h-full bg-transparent text-transparent caret-foreground resize-none focus:outline-none overflow-auto whitespace-pre-wrap break-words"
          value={value}
          onChange={handleInput}
          onScroll={handleScroll}
          onKeyDown={handleKeyDown}
          onSelect={handleSelect}
          readOnly={readOnly}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
        />
      </div>
    </div>
  )
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
