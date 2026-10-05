/** PropertyWorks mark (F1$): multi-building skyline + target with $ in the bullseye. Scales with CSS size. */
export function BrandMark({ className = 'h-7 w-7' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="8" fill="#0f172a" />
      <rect x="1" y="1" width="30" height="30" rx="7" stroke="#6366f1" strokeOpacity="0.5" />

      {/* Left mid-rise */}
      <rect x="4" y="12.5" width="7.2" height="12.5" rx="0.9" fill="#312e81" stroke="#a5b4fc" strokeWidth="1" />
      <rect x="5.4" y="14.2" width="1.7" height="1.7" rx="0.25" fill="#c7d2fe" />
      <rect x="7.9" y="14.2" width="1.7" height="1.7" rx="0.25" fill="#c7d2fe" />
      <rect x="5.4" y="17" width="1.7" height="1.7" rx="0.25" fill="#c7d2fe" />
      <rect x="7.9" y="17" width="1.7" height="1.7" rx="0.25" fill="#c7d2fe" />
      <rect x="5.4" y="19.8" width="1.7" height="1.7" rx="0.25" fill="#c7d2fe" />
      <rect x="7.9" y="19.8" width="1.7" height="1.7" rx="0.25" fill="#c7d2fe" />
      <rect x="6.4" y="22.4" width="2.4" height="2.6" rx="0.25" fill="#e0e7ff" />

      {/* Center tall building */}
      <rect x="10.8" y="8" width="8.4" height="17" rx="1" fill="#3730a3" stroke="#a5b4fc" strokeWidth="1.05" />
      <path d="M10.8 11.2h8.4" stroke="#6366f1" strokeWidth="1" />
      <rect x="12.3" y="12.6" width="2" height="2" rx="0.25" fill="#c7d2fe" />
      <rect x="15.6" y="12.6" width="2" height="2" rx="0.25" fill="#c7d2fe" />
      <rect x="12.3" y="15.6" width="2" height="2" rx="0.25" fill="#c7d2fe" />
      <rect x="15.6" y="15.6" width="2" height="2" rx="0.25" fill="#c7d2fe" />
      <rect x="12.3" y="18.6" width="2" height="2" rx="0.25" fill="#c7d2fe" />
      <rect x="15.6" y="18.6" width="2" height="2" rx="0.25" fill="#c7d2fe" />
      <rect x="13.5" y="21.8" width="3" height="3.2" rx="0.3" fill="#e0e7ff" />

      {/* Right short building */}
      <rect x="18.6" y="14.5" width="6.4" height="10.5" rx="0.85" fill="#312e81" stroke="#a5b4fc" strokeWidth="1" />
      <rect x="19.9" y="16.2" width="1.6" height="1.6" rx="0.25" fill="#c7d2fe" />
      <rect x="22.3" y="16.2" width="1.6" height="1.6" rx="0.25" fill="#c7d2fe" />
      <rect x="19.9" y="18.8" width="1.6" height="1.6" rx="0.25" fill="#c7d2fe" />
      <rect x="22.3" y="18.8" width="1.6" height="1.6" rx="0.25" fill="#c7d2fe" />
      <rect x="20.7" y="21.8" width="2.2" height="3.2" rx="0.25" fill="#e0e7ff" />

      <path d="M4 25h21" stroke="#6366f1" strokeWidth="1" strokeLinecap="round" opacity="0.55" />

      {/* Target with $ in the center (rent focus) */}
      <circle cx="23.8" cy="22.6" r="6.4" fill="#0f172a" fillOpacity="0.65" />
      <circle cx="23.8" cy="22.6" r="6.1" stroke="#818cf8" strokeWidth="1.15" />
      <circle cx="23.8" cy="22.6" r="4.05" stroke="#a5b4fc" strokeWidth="1.05" />
      <circle cx="23.8" cy="22.6" r="2.35" fill="#6366f1" />
      <text x="23.8" y="24.35" textAnchor="middle" fontFamily="system-ui,-apple-system,sans-serif" fontSize="4.2" fontWeight="700" fill="#fff">$</text>
    </svg>
  );
}
