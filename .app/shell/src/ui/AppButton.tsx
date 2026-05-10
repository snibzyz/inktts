import { forwardRef, type ButtonHTMLAttributes, type MouseEvent } from 'react'
import { cn } from './cn'

export type AppButtonColor = 'primary' | 'violet' | 'amber' | 'emerald' | 'sky' | 'pink' | 'zinc'

export interface AppButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'color'> {
  tone?: AppButtonColor
  /** solid = ปุ่มเต็ม, flat = โปร่งใส, chrome = แถบเครื่องมือ IDE, icon = ไอคอนอย่างเดียว */
  variant?: 'solid' | 'flat' | 'chrome' | 'icon'
  /** HeroUI compat — maps to onClick */
  onPress?: () => void
}

// ขนาดเทียบเท่า VS Code action buttons / INKCRAW md (h-10 px-4 text-[13px])
// — ใหญ่กว่า INKIDEA settings dense buttons (h-8) เพราะ INKTTS เป็นหน้า workflow หลัก
const BASE =
  'inline-flex items-center justify-center gap-2 rounded-sm border h-10 px-4 text-[13px] font-medium transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-vscode-focus/40 disabled:cursor-not-allowed disabled:opacity-45'

const SOLID: Record<AppButtonColor, string> = {
  primary: 'border-transparent bg-vscode-accent text-white hover:bg-vscode-accent-hover',
  violet:  'border-transparent bg-[#7d4bd2] text-white hover:bg-[#8a5ee0]',
  amber:   'border-transparent bg-[#b07a00] text-white hover:bg-[#c58a00]',
  emerald: 'border-transparent bg-[#14815c] text-white hover:bg-[#17956a]',
  sky:     'border-transparent bg-[#0d7ea7] text-white hover:bg-[#1090bf]',
  pink:    'border-transparent bg-[#aa3d7c] text-white hover:bg-[#bf4a8d]',
  zinc:    'border-vscode-border bg-vscode-button text-vscode-fg hover:bg-vscode-button-hover',
}

const FLAT: Record<AppButtonColor, string> = {
  primary: 'border-vscode-focus/55 bg-vscode-focus/18 text-[#d8ecff] hover:bg-vscode-focus/26',
  violet:  'border-[#7d4bd2]/35 bg-[#7d4bd2]/14 text-[#e7dcff] hover:bg-[#7d4bd2]/22',
  amber:   'border-[#b07a00]/35 bg-[#b07a00]/14 text-[#ffe4a3] hover:bg-[#b07a00]/22',
  emerald: 'border-[#14815c]/35 bg-[#14815c]/14 text-[#c8ffe8] hover:bg-[#14815c]/22',
  sky:     'border-[#0d7ea7]/35 bg-[#0d7ea7]/14 text-[#d7f2ff] hover:bg-[#0d7ea7]/22',
  pink:    'border-[#aa3d7c]/35 bg-[#aa3d7c]/14 text-[#ffd8ea] hover:bg-[#aa3d7c]/22',
  zinc:    'border-vscode-border bg-transparent text-vscode-fg hover:bg-vscode-list-hover',
}

export const AppButton = forwardRef<HTMLButtonElement, AppButtonProps>(function AppButton(
  { tone = 'primary', variant = 'solid', onPress, onClick, className, children, ...props },
  ref
) {
  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    onClick?.(e)
    onPress?.()
  }

  let toneClass: string
  if (variant === 'icon') {
    toneClass = 'border-transparent bg-transparent !h-10 !w-10 !p-0 text-vscode-muted hover:bg-vscode-list-hover hover:text-vscode-fg'
  } else if (variant === 'chrome') {
    toneClass = tone === 'primary'
      ? 'border-vscode-accent bg-vscode-accent text-white hover:bg-vscode-accent-hover'
      : 'border-vscode-border bg-transparent text-vscode-fg hover:bg-vscode-list-hover'
  } else if (variant === 'flat') {
    toneClass = FLAT[tone]
  } else {
    toneClass = SOLID[tone]
  }

  return (
    <button
      ref={ref}
      type="button"
      className={cn(BASE, toneClass, className)}
      onClick={handleClick}
      {...props}
    >
      {children}
    </button>
  )
})
