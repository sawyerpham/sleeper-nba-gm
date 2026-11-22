import React from "react";
import { createRoot } from "react-dom/client";
import App from "./ui-apple/App.jsx";
import AuthGate from "./core/Auth.jsx";
import "./ui-apple/apple.css";

document.addEventListener("focusin", (e) => {
  if (e.target instanceof HTMLInputElement && e.target.type === "number") e.target.select();
});

// Scrollbars show only while scrolling: mark the element that scrolls, unmark it 700 ms after it stops (styles.css
// [data-scrolling]). A data attribute, not a class, so React re-renders don't wipe it mid-scroll.
const stopTimers = new WeakMap();
document.addEventListener("scroll", (e) => {
  const el = e.target === document ? document.scrollingElement : e.target;
  if (!(el instanceof Element)) return;
  el.dataset.scrolling = "";
  clearTimeout(stopTimers.get(el));
  stopTimers.set(el, setTimeout(() => delete el.dataset.scrolling, 700));
}, { capture: true, passive: true });

document.documentElement.dataset.theme = "apple";   // before the sign-in gate, so the login page has the app's theme too

createRoot(document.getElementById("root")).render(<AuthGate>{(user) => <App user={user} />}</AuthGate>);
