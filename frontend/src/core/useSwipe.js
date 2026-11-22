import { useRef } from "react";

/** Touch props that call onSwipe(+1) on a left swipe and onSwipe(-1) on a right one (mostly horizontal, 40px+). */
export default function useSwipe(onSwipe) {
  const start = useRef(null);
  return {
    onTouchStart: (e) => { const t = e.touches[0]; start.current = [t.clientX, t.clientY]; },
    onTouchEnd: (e) => {
      if (!start.current) return;
      const t = e.changedTouches[0], dx = t.clientX - start.current[0], dy = t.clientY - start.current[1];
      start.current = null;
      if (Math.abs(dx) >= 40 && Math.abs(dx) > 1.5 * Math.abs(dy)) onSwipe(dx < 0 ? 1 : -1);
    },
  };
}
