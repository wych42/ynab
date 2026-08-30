import express from "express";

export function startTestApi(api) {
  const app = express();
  app.use(express.json({ limit: "15mb" }));
  app.use("/api", api);
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("test server did not bind a TCP port"));
        return;
      }
      const baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve({
        baseUrl,
        async call(method, url, body) {
          const res = await fetch(baseUrl + url, {
            method,
            headers: { "content-type": "application/json" },
            body: body !== undefined ? JSON.stringify(body) : undefined,
          });
          return { status: res.status, json: await res.json() };
        },
        close() {
          return new Promise((done, fail) => server.close((err) => (err ? fail(err) : done())));
        },
      });
    });
    server.on("error", reject);
  });
}
