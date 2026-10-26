import { createApp } from "./app.js";
const production = process.argv.includes("--production");
const app = createApp(undefined, { production });
if (production) {
  const express = (await import("express")).default;
  app.use(express.static("dist"));
  app.get("/{*path}", (req, res) =>
    res.sendFile("index.html", { root: "dist" }),
  );
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
const port = Number(process.env.PORT || 3000);
app.listen(port, process.env.HOST || "127.0.0.1", () =>
  console.log(`Local: http://127.0.0.1:${port}`),
);
