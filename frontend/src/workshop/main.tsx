import React from "react";
import { createRoot } from "react-dom/client";
import WorkshopApp from "./App";
import ProductionApp from "./ProductionApp";
import "./workshop.css";
import "./production.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{new URLSearchParams(location.search).get('mode') === 'demo' ? <WorkshopApp /> : <ProductionApp />}</React.StrictMode>,
);
