import type { ReactNode } from 'react'
import { MacHint } from './MacHint'
import { cn } from './cn'

type MacFieldLabelProps = {
  children: ReactNode
  hint?: string
  className?: string
}

export function MacFieldLabel({ children, hint, className }: MacFieldLabelProps) {
  return (
    <div className={cn('mb-1.5 flex items-center gap-1.5', className)}>
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-vscode-muted">{children}</span>
      {hint ? (
        <MacHint title={hint}>
          <span
            className="inline-flex h-[16px] min-w-[16px] cursor-default items-center justify-center rounded-sm border border-vscode-border bg-vscode-input px-1 text-[9px] font-bold text-vscode-muted"
            tabIndex={0}
          >
            ?
          </span>
        </MacHint>
      ) : null}
    </div>
  )
}
