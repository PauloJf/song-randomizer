import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import AdminApp from "./admin/AdminApp";
import "./index.css";

// Two pages, one bundle: the server's SPA fallback serves index.html for
// /admin too, and we pick the screen off the path. No router dependency.
const Page = window.location.pathname.startsWith("/admin") ? AdminApp : App;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Page />
  </React.StrictMode>,
);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* SW is progressive enhancement — non-fatal */
    });
  });
}
