import type { HTMLAttributes } from 'react'
import { cn } from './cn'

export type MacPanelProps = HTMLAttributes<HTMLDivElement> & {
  variant?: 'default' | 'accent' | 'subtle' | 'canvas'
}

/**
 * legacy alias: แผงกลางของแอป แต่คุมฐานเป็น VS Code square style
 */
export function MacPanel({ className, variant = 'default', ...rest }: MacPanelProps) {
  const surface = {
    default: 'rounded-sm border border-vscode-border bg-vscode-sidebar/35 shadow-none',
    accent: 'rounded-sm border border-amber-500/28 bg-amber-500/[0.07] shadow-none',
    subtle: 'rounded-sm border border-vscode-border bg-vscode-input/20 shadow-none',
    canvas: 'rounded-sm border border-vscode-border bg-vscode-editor/40 shadow-none',
  }[variant]

  return <div className={cn(surface, 'min-w-0 p-4', className)} {...rest} />
}
