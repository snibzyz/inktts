import type { ReactNode } from 'react'
import { cn } from './cn'

interface AppCardProps {
  title?: string
  description?: string
  action?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}

export function AppCard({ title, description, action, children, className, bodyClassName }: AppCardProps) {
  return (
    <div className={cn('overflow-hidden rounded-sm border border-vscode-border bg-vscode-sidebar/35', className)}>
      {(title || description || action) && (
        <div className="flex items-start justify-between gap-4 border-b border-vscode-border px-4 py-3">
          <div>
            {title ? <h3 className="text-[13px] font-semibold text-vscode-fg-bright">{title}</h3> : null}
            {description ? <p className="mt-1 text-[12px] text-vscode-fg-dim">{description}</p> : null}
          </div>
          {action}
        </div>
      )}
      <div className={cn('px-4 py-4', bodyClassName)}>{children}</div>
    </div>
  )
}
