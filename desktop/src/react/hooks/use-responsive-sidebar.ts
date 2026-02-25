import { useEffect, useState } from "react";

const MOBILE_MEDIA_QUERY = "(max-width: 1023px)";

export function useResponsiveSidebar() {
  const [isMobileLike, setIsMobileLike] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(MOBILE_MEDIA_QUERY).matches : false,
  );
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia(MOBILE_MEDIA_QUERY);
    const handleChange = (event: MediaQueryListEvent) => {
      setIsMobileLike(event.matches);
      // Desktop keeps sidebar visible while mobile defaults to an overlay drawer.
      setIsSidebarOpen(!event.matches);
    };

    setIsMobileLike(mediaQuery.matches);
    mediaQuery.addEventListener("change", handleChange);

    return () => {
      mediaQuery.removeEventListener("change", handleChange);
    };
  }, []);

  useEffect(() => {
    if (!isSidebarOpen || !isMobileLike) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsSidebarOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isSidebarOpen, isMobileLike]);

  return {
    isMobileLike,
    isSidebarOpen,
    setIsSidebarOpen,
  };
}
