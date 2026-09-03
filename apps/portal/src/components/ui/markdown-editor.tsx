'use client'

import { useMemo } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { EditorView } from '@codemirror/view'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { oneDark } from '@codemirror/theme-one-dark'

interface MarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  readOnly?: boolean
  height?: string
  theme?: 'light' | 'dark'
}

export function MarkdownEditor({
  value,
  onChange,
  readOnly = false,
  height = '500px',
  theme = 'dark',
}: MarkdownEditorProps) {
  const extensions = useMemo(
    () => [
      markdown({ base: markdownLanguage }),
      EditorView.lineWrapping,
    ],
    []
  )

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <CodeMirror
        value={value}
        height={height}
        readOnly={readOnly}
        onChange={onChange}
        theme={theme === 'dark' ? oneDark : 'light'}
        extensions={extensions}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLine: true,
          highlightActiveLineGutter: true,
          foldGutter: true,
          autocompletion: true,
          bracketMatching: true,
          closeBrackets: true,
          indentOnInput: true,
        }}
      />
    </div>
  )
}
