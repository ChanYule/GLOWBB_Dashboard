try {
  const root = document.documentElement;
  root.dataset.theme = localStorage.getItem("glow.display.theme") || "system";
  root.dataset.chartSize = localStorage.getItem("glow.display.size") || "standard";
} catch { /* System theme remains available without local storage. */ }
