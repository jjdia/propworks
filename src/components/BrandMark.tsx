/** Compact PropertyWorks mark for the app header. Scales with CSS size. */
export function BrandMark({ className = 'h-7 w-7' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="8" fill="#1e1b4b" />
      <rect x="1" y="1" width="30" height="30" rx="7" stroke="#4f46e5" strokeOpacity="0.45" />
      {/* Building body */}
      <path
        d="M8 25V12.5L16 7l8 5.5V25H8Z"
        fill="#312e81"
        stroke="#a5b4fc"
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
      {/* Roofline accent */}
      <path d="M16 7L8 12.5h16L16 7Z" fill="#6366f1" />
      {/* Windows — three floors, two columns */}
      <rect x="11.25" y="14" width="2.75" height="2.75" rx="0.4" fill="#c7d2fe" />
      <rect x="18" y="14" width="2.75" height="2.75" rx="0.4" fill="#c7d2fe" />
      <rect x="11.25" y="18.25" width="2.75" height="2.75" rx="0.4" fill="#c7d2fe" />
      <rect x="18" y="18.25" width="2.75" height="2.75" rx="0.4" fill="#c7d2fe" />
      {/* Door */}
      <rect x="14.5" y="21.5" width="3" height="3.5" rx="0.35" fill="#e0e7ff" />
    </svg>
  );
}
