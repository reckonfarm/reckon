'use client'

import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
} from 'react'

// Form primitives — quiet, token-based, accessible. One `Field` wrapper (label + control +
// hint/error, fully a11y-wired) plus `Input` and `Select` controls that share one look.
// Built for herd-lot entry (head count = number, weight class / type = enum select, …) but
// carry no app logic. Surfaces: bg-surface, hairline border-line, ink text, accent focus
// ring; warning border + message on error. 44px min target. Number inputs pick up the
// `tabular-price` figure treatment so entered counts align.

const CONTROL =
  'w-full min-h-[44px] rounded-lg border bg-surface px-3 py-2.5 font-dm-sans text-sm text-ink ' +
  'outline-none transition-colors placeholder:text-muted/40 ' +
  'focus:ring-2 focus:ring-accent/20 ' +
  'disabled:cursor-not-allowed disabled:opacity-50'

// Border + focus border follow validity so the error state reads without color alone fighting
// the ring (the message below carries the meaning; aria-invalid carries it for AT).
const borderFor = (invalid?: boolean) =>
  invalid ? 'border-warning focus:border-warning' : 'border-line/20 focus:border-accent'

export function Input({
  invalid,
  className = '',
  type = 'text',
  ref,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; ref?: Ref<HTMLInputElement> }) {
  return (
    <input
      ref={ref}
      type={type}
      aria-invalid={invalid || undefined}
      className={`${CONTROL} ${borderFor(invalid)} ${type === 'number' ? 'tabular-price' : ''} ${className}`}
      {...rest}
    />
  )
}

export function Select({
  invalid,
  className = '',
  children,
  ref,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean; ref?: Ref<HTMLSelectElement> }) {
  return (
    <div className="relative">
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        // appearance-none + our own chevron so the control matches Input across platforms.
        className={`${CONTROL} ${borderFor(invalid)} cursor-pointer appearance-none pr-9 ${className}`}
        {...rest}
      >
        {children}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted/50"
      >
        <path d="M6 8l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

// Props the Field injects into its single control child via cloneElement.
type ControlProps = {
  id?: string
  invalid?: boolean
  required?: boolean
  'aria-describedby'?: string
}

export function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: string
  hint?: string
  error?: string
  required?: boolean
  /** Exactly one control (Input/Select) — Field wires id + aria + invalid into it. */
  children: ReactNode
}) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined

  const only = Children.only(children)
  const control = isValidElement<ControlProps>(only)
    ? cloneElement(only, {
        id,
        required,
        invalid: Boolean(error) || only.props.invalid,
        'aria-describedby': describedBy,
      })
    : only

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="font-dm-sans text-sm font-medium text-ink">
        {label}
        {required && <span aria-hidden="true" className="text-warning"> *</span>}
      </label>
      {control}
      {hint && !error && (
        <p id={hintId} className="font-dm-sans text-xs text-muted/70">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="font-dm-sans text-xs font-medium text-warning">
          {error}
        </p>
      )}
    </div>
  )
}

export default Field
