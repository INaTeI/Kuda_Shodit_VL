import { GeoProvider, CookieNotice } from "./geo";
import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { SessionProvider } from "./state";
import App from "./App";
import { AdminProvider } from "./admin";
import "./styles.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <AdminProvider>
        <GeoProvider>
          <CookieNotice />
          <App />
        </GeoProvider>
        </AdminProvider>
      </SessionProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
