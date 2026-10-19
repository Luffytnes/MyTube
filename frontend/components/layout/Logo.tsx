import Link from 'next/link'
import { cn } from '@/lib/utils'

/** Brand mark: rounded gradient tile with a soft play triangle. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'relative inline-flex items-center justify-center w-8 h-8 rounded-[10px] bg-accent-gradient shadow-glow',
        className,
      )}
    >
      <svg viewBox="0 0 24 24" className="w-[15px] h-[15px] translate-x-[1px]" aria-hidden="true">
        <path
          d="M7.5 5.6c0-1.2 1.3-1.9 2.3-1.3l9.3 5.9c.9.6.9 2 0 2.6l-9.3 5.9c-1 .6-2.3-.1-2.3-1.3V5.6z"
          fill="white"
        />
      </svg>
      <span className="absolute inset-0 rounded-[10px] ring-1 ring-inset ring-white/25" />
    </span>
  )
}

/** Logo linking home; `suffix` names a sub-app (Music, TV). */
export default function Logo({ href = '/', suffix }: { href?: string; suffix?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2.5 flex-shrink-0 group" aria-label="MyTube">
      <LogoMark className="transition-transform duration-300 group-hover:scale-105 group-hover:-rotate-3" />
      <span className="hidden sm:flex items-baseline gap-1.5 font-display text-[19px] font-bold tracking-tight text-yt-text">
        MyTube
        {suffix && <span className="text-gradient font-semibold">{suffix}</span>}
      </span>
    </Link>
  )
}
