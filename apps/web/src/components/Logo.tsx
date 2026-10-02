import clsx from 'clsx';

export function Logo({ className }: { className?: string }) {
  return (
    <span className={clsx('flex items-center gap-2 text-lg font-semibold tracking-tight', className)}>
      <svg viewBox="0 0 32 32" className="size-7" aria-hidden>
        <rect width="32" height="32" rx="8" fill="#0f766e" />
        <path d="M8 11l8-4 8 4-8 4-8-4z" fill="#fff" />
        <path d="M8 15.5l8 4 8-4M8 20l8 4 8-4" fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
      </svg>
      EstoqueIn
    </span>
  );
}
