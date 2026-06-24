import { useEffect, useState, type InputHTMLAttributes } from 'react';
import { Input } from './Input';

// NumberField — number input ที่ "ลบให้ว่างได้"
//
// ปัญหาเดิมของ controlled <input type="number">: พอ user ลบจนว่าง โค้ดมัก parse
// แล้ว fallback เป็น min/ค่าเดิมทันที (เช่น `parseInt(v) || 1`) → ช่องเด้งกลับเป็น 1
// ทุกครั้ง พิมพ์เลขใหม่ไม่ได้ — UX แย่
//
// วิธีแก้: เก็บ draft เป็น string ระหว่างที่ช่องโฟกัส (ปล่อยให้ว่างได้) แล้วค่อย
// commit เป็นตัวเลขตอน blur/Enter. ระหว่างพิมพ์ถ้าเป็นตัวเลขที่ถูกต้องจะ commit
// ทันที (ให้ preview/ค่าอื่นอัปเดต real-time); ถ้าตอน blur ยังว่าง/ไม่ใช่ตัวเลข →
// กลับไปค่าเดิม. รูปแบบเดียวกับ RateStepper
//
// useNumberDraft() แยกไว้ให้ component ที่มีปุ่ม +/- (เช่น Spinbox) เอา inputProps
// ไปแปะกับ <input> ที่ style เองได้
//
// (copy จาก .shared/ui/NumberField.tsx — แก้ที่ .shared แล้ว propagate มาที่นี่)

export function useNumberDraft(
  value: number,
  onChange: (n: number) => void,
  opts: { min?: number; max?: number } = {},
) {
  const { min, max } = opts;
  const clamp = (n: number) => {
    let r = n;
    if (min != null) r = Math.max(min, r);
    if (max != null) r = Math.min(max, r);
    return r;
  };

  const [draft, setDraft] = useState(String(value));
  const [editing, setEditing] = useState(false);
  // ค่าเปลี่ยนจากภายนอก (เช่น auto-detect, reset) → sync draft เฉพาะตอนไม่ได้พิมพ์อยู่
  useEffect(() => {
    if (!editing) setDraft(String(value));
  }, [value, editing]);

  const bump = (dir: 1 | -1) => {
    const parsed = parseInt(draft, 10);
    const base = Number.isFinite(parsed) ? parsed : value;
    const next = clamp(base + dir);
    onChange(next);
    setDraft(String(next));
  };

  const inputProps: InputHTMLAttributes<HTMLInputElement> = {
    type: 'text',
    inputMode: 'numeric',
    value: draft,
    onFocus: () => {
      setEditing(true);
      // ไม่ select() ทั้งหมด — คลิกแล้ววาง cursor ปกติ (กด Ctrl+A เองถ้าจะเลือกหมด)
    },
    onChange: (e) => {
      const t = e.target.value;
      // ปล่อยให้ว่าง หรือเฉพาะตัวเลขล้วน — กันตัวอักษร/เครื่องหมายแปลก ๆ
      if (t !== '' && !/^\d+$/.test(t)) return;
      setDraft(t);
      const n = parseInt(t, 10);
      if (Number.isFinite(n)) onChange(clamp(n));
    },
    onBlur: () => {
      setEditing(false);
      const n = parseInt(draft, 10);
      if (Number.isFinite(n)) {
        const c = clamp(n);
        onChange(c);
        setDraft(String(c));
      } else {
        // ว่าง/ไม่ใช่ตัวเลข → คืนค่าเดิม (ไม่ snap ระหว่างพิมพ์)
        setDraft(String(value));
      }
    },
    onKeyDown: (e) => {
      if (e.key === 'Enter') {
        e.currentTarget.blur();
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        bump(1);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        bump(-1);
      }
    },
  };

  return { draft, setDraft, setEditing, clamp, bump, inputProps };
}

interface NumberFieldProps {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  className?: string;
  invalid?: boolean;
  disabled?: boolean;
  placeholder?: string;
  title?: string;
  'aria-label'?: string;
}

export function NumberField({ value, onChange, min, max, className, invalid, ...rest }: NumberFieldProps) {
  const { inputProps } = useNumberDraft(value, onChange, { min, max });
  return <Input invalid={invalid} className={className} {...rest} {...inputProps} />;
}
