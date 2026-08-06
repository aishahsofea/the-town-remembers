import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

/**
 * The browser never constructs an absolute API URL. Locally the proxy forwards
 * `/api` to the node:http adapter; in the deployed topology CloudFront routes
 * the same path to API Gateway. Testing the exact `/api/v1/health` path keeps
 * a local convenience from hiding a production routing mistake.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL("../..", import.meta.url)), "");
  const apiPort = Number(env["TTR_API_PORT"] ?? 5174);
  const webPort = Number(env["TTR_WEB_PORT"] ?? 5173);

  return {
    plugins: [react()],
    envDir: fileURLToPath(new URL("../..", import.meta.url)),
    server: {
      port: webPort,
      strictPort: true,
      proxy: { "/api": { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false } },
    },
    preview: { port: webPort, strictPort: true },
    build: { outDir: "dist", sourcemap: true },
  };
});
