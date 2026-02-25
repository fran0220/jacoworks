/**
 * OpenClaw logo icon — stylized open pincer/claw.
 * Same API as lucide-react icons (size, className, etc.)
 */
export default function ClawIcon({
  size = 24,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Left pincer arm: base → outer curve → top → tip curls inward */}
      <path d="M12 21C10 16 5 13 4 9C3 5 5 2 8 3C10 4 10 7 9 8" />
      {/* Right pincer arm: mirror */}
      <path d="M12 21C14 16 19 13 20 9C21 5 19 2 16 3C14 4 14 7 15 8" />
    </svg>
  );
}
