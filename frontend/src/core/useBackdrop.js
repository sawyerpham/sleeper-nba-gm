import { useRef } from "react";

/** Props for a popup's backdrop: a click or tap that starts and ends on the backdrop itself calls close. Uses click,
 * not mousedown: iOS Safari only fires mouse events on tappable elements, and closing on press would let the
 * tap's click land on the page underneath. Dragging a text selection out of the popup doesn't close it. */
export default function useBackdrop(close) {
  const down = useRef(false);
  return {
    onPointerDown: (e) => { down.current = e.target === e.currentTarget; },
    onClick: (e) => { if (down.current && e.target === e.currentTarget) close(); },
  };
}
