/** Animated night landscape for the welcome screen: stars, moon, Tian-Shan ridges, Kyrgyz flag, birds. */
export function MountainScene() {
  const stars = Array.from({ length: 46 }, (_, i) => ({ x: (i * 37) % 390, y: (i * 53) % 330, r: (i % 3) * 0.5 + 0.6, d: (i % 7) * 0.4 }));
  return (
    <div className="absolute inset-0 overflow-hidden" aria-hidden>
      <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, #050b0d 0%, #0a1a20 35%, #10262b 60%, #0b100e 100%)' }} />
      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 390 852" preserveAspectRatio="xMidYMid slice">
        {stars.map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#dfe9ff" className="twinkle" style={{ animationDelay: `${s.d}s` }} />
        ))}
        <circle cx="320" cy="90" r="22" fill="#fdf6d8" opacity="0.9" />
        <circle cx="312" cy="84" r="20" fill="#0a1a20" opacity="0.85" />
        {/* aurora */}
        <ellipse cx="120" cy="140" rx="200" ry="60" fill="url(#aur)" opacity="0.35" />
        <defs>
          <linearGradient id="aur" x1="0" x2="1">
            <stop offset="0" stopColor="#22c55e" stopOpacity="0" />
            <stop offset="0.5" stopColor="#22c55e" />
            <stop offset="1" stopColor="#22c55e" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="m1" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#3b5563" />
            <stop offset="1" stopColor="#111c22" />
          </linearGradient>
          <linearGradient id="m2" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#2a3f4b" />
            <stop offset="1" stopColor="#0d161b" />
          </linearGradient>
          <linearGradient id="m3" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#1b2b33" />
            <stop offset="1" stopColor="#0b100e" />
          </linearGradient>
        </defs>
        {/* far ridge */}
        <path d="M-20 560 L40 470 L90 520 L140 430 L190 500 L240 410 L300 490 L350 440 L410 520 L410 852 L-20 852Z" fill="url(#m3)" />
        {/* snow caps far */}
        <path d="M140 430 L128 452 L152 452Z M240 410 L226 436 L254 436Z M350 440 L338 460 L362 460Z" fill="#e8f1f5" opacity="0.9" />
        {/* mid ridge */}
        <path d="M-20 640 L30 560 L80 610 L130 520 L180 600 L230 530 L280 610 L330 540 L390 620 L410 852 L-20 852Z" fill="url(#m2)" />
        <path d="M130 520 L112 556 L150 556Z M230 530 L212 566 L250 566Z M330 540 L316 570 L348 570Z" fill="#f3f8fa" />
        {/* near ridge */}
        <path d="M-20 720 L40 650 L100 700 L160 630 L220 700 L280 650 L340 710 L410 660 L410 852 L-20 852Z" fill="url(#m1)" />
        <path d="M160 630 L138 672 L184 672Z M280 650 L262 684 L300 684Z" fill="#ffffff" opacity="0.95" />
        {/* birds */}
        <g className="drift" style={{ animationDuration: '32s' }}>
          <path d="M20 180 q6 -6 12 0 q6 -6 12 0" stroke="#cfd8dc" strokeWidth="1.6" fill="none" />
          <path d="M40 195 q5 -5 10 0 q5 -5 10 0" stroke="#cfd8dc" strokeWidth="1.4" fill="none" />
        </g>
        <g className="drift" style={{ animationDuration: '44s', animationDelay: '-18s' }}>
          <path d="M0 240 q5 -5 10 0 q5 -5 10 0" stroke="#b0bec5" strokeWidth="1.3" fill="none" />
        </g>
        {/* flag */}
        <g transform="translate(300 560)">
          <rect x="0" y="0" width="3" height="120" fill="#d9dde0" />
          <path d="M3 4 Q30 -4 58 6 L58 46 Q30 54 3 44Z" fill="#e4312b" className="float" />
          <circle cx="31" cy="25" r="10" fill="#ffd400" />
          <circle cx="31" cy="25" r="6" fill="#e4312b" />
          <path d="M25 25 q6 -4 12 0 M25 25 q6 4 12 0" stroke="#ffd400" strokeWidth="1.4" fill="none" />
        </g>
      </svg>
      <div className="absolute inset-x-0 bottom-0 h-72" style={{ background: 'linear-gradient(180deg, rgba(11,16,14,0) 0%, #0b100e 70%)' }} />
    </div>
  );
}
