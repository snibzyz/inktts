import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from './cn'

export type MacHintProps = {
  /** ข้อความคำอธิบาย (คล้าย NSPanel tooltip บน macOS) */
  title: string
  children: ReactNode
  /** ด้านของทริกเกอร์ — top = แสดงเหนือ, bottom = ใต้ */
  side?: 'top' | 'bottom'
  /** จัดกับทริกเกอร์ — start = ชิดซ้ายของไอคอน (อ่านยาวแนวนอนในคอลัมน์แคบ), center = กึ่งกลาง */
  align?: 'center' | 'start'
  /** wide = กล่องกว้าง ข้อความไม่ยืดเป็นคอลัมน์แคบ */
  density?: 'compact' | 'wide'
  /** ดีเลย์ก่อนแสดง — ค่าเริ่มต้นใกล้เคียงระบบ */
  delayMs?: number
  className?: string
}

/**
 * คำใบ้แบบ macOS: แสดงผ่าน portal ที่ document.body — ไม่โดนตัดโดย overflow:hidden ของแถบเลื่อน/การ์ด
 */
export function MacHint({
  title,
  children,
  side = 'bottom',
  align = 'start',
  density = 'wide',
  delayMs = 520,
  className,
}: MacHintProps) {
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const triggerRef = useRef<HTMLSpanElement>(null)
  const [coords, setCoords] = useState<{ top: number; left: number; transform: string; maxWidth: number }>({
    top: 0,
    left: 0,
    transform: 'none',
    maxWidth: 560,
  })

  const scheduleShow = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(true), delayMs)
  }, [delayMs])

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    setOpen(false)
  }, [])

  const updatePosition = useCallback(() => {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const pad = 10
    const maxW =
      density === 'wide' ? Math.min(560, window.innerWidth - pad * 2) : Math.min(300, window.innerWidth - pad * 2)

    const estH = 120
    let top = side === 'bottom' ? r.bottom + 8 : r.top - estH - 8
    if (side === 'bottom' && top + estH > window.innerHeight - pad) {
      top = Math.max(pad, r.top - estH - 8)
    }
    if (side === 'top' && top < pad) {
      top = Math.min(window.innerHeight - estH - pad, r.bottom + 8)
    }

    let left: number
    let transform: string
    if (align === 'center') {
      left = r.left + r.width / 2
      transform = 'translateX(-50%)'
    } else {
      left = r.left
      transform = 'none'
    }

    if (left < pad) left = pad
    if (left + maxW > window.innerWidth - pad && align === 'start') {
      left = Math.max(pad, window.innerWidth - pad - maxW)
    }

    setCoords({ top, left, transform, maxWidth: maxW })
  }, [side, align, density])

  useLayoutEffect(() => {
    if (!open) return
    updatePosition()
  }, [open, updatePosition, title])

  useEffect(() => {
    if (!open) return
    const onScroll = () => updatePosition()
    const onResize = () => updatePosition()
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open, updatePosition])

  const maxWClass =
    density === 'wide'
      ? 'max-w-[min(560px,min(92vw,calc(100vw-32px)))]'
      : 'max-w-[min(300px,85vw)]'

  const tooltip =
    open &&
    createPortal(
      <span
        role="tooltip"
        className={cn(
          'pointer-events-none fixed z-[100001] block w-max min-w-[12rem] rounded-sm border border-vscode-border bg-vscode-editor px-3 py-2 text-left text-[11px] font-medium leading-relaxed text-vscode-fg shadow-[0_10px_36px_rgb(0_0_0/0.45)]',
          maxWClass
        )}
        style={{
          top: coords.top,
          left: coords.left,
          transform: coords.transform,
          maxWidth: coords.maxWidth,
        }}
      >
        {title}
      </span>,
      document.body
    )

  return (
    <>
      <span
        ref={triggerRef}
        className={cn('relative inline-flex items-center overflow-visible', className)}
        onMouseEnter={scheduleShow}
        onMouseLeave={clear}
        onFocus={scheduleShow}
        onBlur={clear}
      >
        {children}
      </span>
      {tooltip}
    </>
  )
}
