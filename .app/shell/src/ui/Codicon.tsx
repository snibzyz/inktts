/**
 * Codicon — React wrapper รอบ @vscode/codicons icon font
 *
 * ใช้ได้ทุกที่ที่อยากได้ไอคอนสไตล์ VS Code — เลือก name ตรง ๆ จาก codicon glyph list
 * (https://microsoft.github.io/vscode-codicons/dist/codicon.html)
 *
 * Examples:
 *   <Codicon name="gear" />
 *   <Codicon name="folder-opened" className="text-vscode-focus" />
 *   <Codicon name="check" size={14} />
 *
 * โดย default codicon font จะเรนเดอร์ที่ 16px — prop `size` ปรับ font-size ให้พอดี
 * กับขนาด text-[12px]/[13px] ของหน้าตั้งค่า
 */

import { cn } from './cn'
import type { CSSProperties, HTMLAttributes } from 'react'

export type CodiconName = string

export type CodiconProps = Omit<HTMLAttributes<HTMLSpanElement>, 'children'> & {
  name: CodiconName
  /** font-size px ของ glyph (default 14 — พอดีกับ text-[12px]) */
  size?: number
  /** เปิด animation spin (สำหรับ loading) */
  spin?: boolean
}

export function Codicon({ name, size = 14, spin = false, className, style, ...rest }: CodiconProps) {
  const finalStyle: CSSProperties = {
    ...style,
    fontSize: size,
    lineHeight: `${size}px`,
    width: size,
    height: size,
  }
  return (
    <span
      role="img"
      aria-hidden
      className={cn(
        'codicon inline-flex shrink-0 items-center justify-center align-[-2px]',
        `codicon-${name}`,
        spin ? 'codicon-modifier-spin' : '',
        className
      )}
      style={finalStyle}
      {...rest}
    />
  )
}
