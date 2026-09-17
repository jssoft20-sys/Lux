export function LogoMark({ size = 48 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 128 128" fill="none" aria-hidden>
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4ADE80" />
          <stop offset="1" stopColor="#15803D" />
        </linearGradient>
        <linearGradient id="lg2" x1="1" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#22C55E" />
          <stop offset="1" stopColor="#166534" />
        </linearGradient>
      </defs>
      <path d="M64 12 26 40l22 9 16-12 16 12 22-9z" fill="url(#lg)" />
      <path d="M64 116 102 88l-22-9-16 12-16-12-22 9z" fill="url(#lg2)" />
      <path d="M48 49 26 40v30l22 9z" fill="#22C55E" opacity=".6" />
      <path d="M80 49l22-9v30l-22 9z" fill="#22C55E" opacity=".6" />
      <path d="M48 79 26 70l22-9 16 12z" fill="#4ADE80" opacity=".35" />
      <path d="M80 79l22-9-22-9-16 12z" fill="#4ADE80" opacity=".35" />
    </svg>
  );
}

export function Wordmark({ size = 28, className = '' }: { size?: number; className?: string }) {
  return (
    <span className={`font-extrabold tracking-tight ${className}`} style={{ fontSize: size, lineHeight: 1 }}>
      Somex
    </span>
  );
}
