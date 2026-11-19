import React from "react";
import { createRoot } from "react-dom/client";

document.addEventListener("focusin", (e) => {
  if (e.target instanceof HTMLInputElement && e.target.type === "number") e.target.select();
});

const LOADERS = {
  command: () => [import("./ui-command/App.jsx"), import("./ui-command/command.css")],
  broadcast: () => [import("./ui-broadcast/App.jsx"), import("./ui-broadcast/broadcast.css")],
  apple: () => [import("./ui-apple/App.jsx"), import("./ui-apple/apple.css")],
};
const ui = (() => { try { return localStorage.getItem("da.ui") || ""; } catch { return ""; } })();
Promise.all((LOADERS[ui] || (() => [import("./App.jsx"), import("./styles.css")]))())
  .then(([{ default: App }]) => createRoot(document.getElementById("root")).render(<App />));
