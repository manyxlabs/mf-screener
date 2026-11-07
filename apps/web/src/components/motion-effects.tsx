"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * The portfolio's pointer spotlight with its slight tilt on `.spotlight` cards, and its
 * Reveal on `[data-reveal]` elements (styled in globals.css). Both are for content pages
 * only; tables, forms and reading surfaces carry neither.
 */
export function MotionEffects() {
  const pathname = usePathname();

  useEffect(() => {
    const tilt = !matchMedia("(prefers-reduced-motion: reduce)").matches;
    let active: HTMLElement | null = null;
    const onMove = (event: PointerEvent) => {
      const el = (event.target as Element | null)?.closest<HTMLElement>(".spotlight") ?? null;
      if (active && active !== el) active.style.rotate = "";
      active = el;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      el.style.setProperty("--x", `${px}px`);
      el.style.setProperty("--y", `${py}px`);
      if (!tilt) return;
      const nx = (px / rect.width) * 2 - 1;
      const ny = (py / rect.height) * 2 - 1;
      const amount = Math.hypot(nx, ny);
      el.style.rotate = amount ? `${-ny} ${nx} 0 ${amount * 2.5}deg` : "";
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  // Per page: a client navigation brings new elements to observe.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("revealed");
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.15 },
    );
    // What the server already painted in view stays put: fading it out and back in after
    // hydration would only flash it.
    for (const el of document.querySelectorAll("[data-reveal]:not(.revealed)")) {
      if (el.getBoundingClientRect().top < innerHeight) el.classList.add("revealed");
      else observer.observe(el);
    }
    document.documentElement.dataset.reveal = "";
    return () => observer.disconnect();
  }, [pathname]);

  return null;
}
