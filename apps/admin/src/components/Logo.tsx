export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 128 128" fill="none" aria-hidden>
      <defs>
        <linearGradient id="alg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4ADE80" />
          <stop offset="1" stopColor="#15803D" />
        </linearGradient>
      </defs>
      <path d="M64 12 26 40l22 9 16-12 16 12 22-9z" fill="url(#alg)" />
      <path d="M64 116 102 88l-22-9-16 12-16-12-22 9z" fill="url(#alg)" opacity=".9" />
      <path d="M48 49 26 40v30l22 9zM80 49l22-9v30l-22 9z" fill="#22C55E" opacity=".55" />
    </svg>
  );
}
