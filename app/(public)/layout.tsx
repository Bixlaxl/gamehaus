"use client";

import { useEffect } from "react";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const html = document.documentElement;
    const hadDark = html.classList.contains("dark");

    // Force light mode on mount
    html.classList.remove("dark");
    html.classList.add("light");

    return () => {
      // Restore on unmount if it was originally dark
      if (hadDark) {
        html.classList.remove("light");
        html.classList.add("dark");
      }
    };
  }, []);

  return <>{children}</>;
}
