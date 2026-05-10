import { forwardRef, type InputHTMLAttributes, type SelectHTMLAttributes } from 'react';
import { cn } from './cn';

const FIELD_BASE = cn(
  'h-10 px-3 text-[13px] bg-vscode-input border border-vscode-input-border rounded-sm text-vscode-fg outline-none',
  'placeholder:text-vscode-muted',
  'focus:border-vscode-focus focus:ring-1 focus:ring-vscode-focus/35',
  'disabled:cursor-not-allowed disabled:opacity-50',
);

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      {...rest}
      className={cn(FIELD_BASE, invalid && 'border-vscode-error', className)}
    />
  );
});

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid, className, children, ...rest },
  ref,
) {
  return (
    <select
      ref={ref}
      {...rest}
      className={cn(FIELD_BASE, invalid && 'border-vscode-error', className)}
    >
      {children}
    </select>
  );
});
