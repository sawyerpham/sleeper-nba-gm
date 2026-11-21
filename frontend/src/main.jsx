import React from "react";
import { createRoot } from "react-dom/client";
import App from "./ui-apple/App.jsx";
import "./ui-apple/apple.css";

document.addEventListener("focusin", (e) => {
  if (e.target instanceof HTMLInputElement && e.target.type === "number") e.target.select();
});

createRoot(document.getElementById("root")).render(<App />);
