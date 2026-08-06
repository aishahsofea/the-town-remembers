import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

import { readLocalDefaults } from "../../scripts/local-env.mjs";

/**
 * The browser never constructs an absolute API URL. Locally the proxy forwards
 * `/api` to the node:http adapter; in the deployed topology CloudFront routes
 * the same path to API Gateway. Testing the exact `/api/v1/health` path keeps
 * a local convenience from hiding a production routing mistake.
 */
export default defineConfig(({ mode }) => {
  const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
  const env = {
    ...readLocalDefaults(repositoryRoot),
    ...loadEnv(mode, repositoryRoot, ""),
  };
  const apiPort = Number(env["TTR_API_PORT"] ?? 5174);
  const webPort = Number(env["TTR_WEB_PORT"] ?? 5173);

  return {
    // Set explicitly so the server can be started from the repository root
    // with `--config`, which is what the browser journey does.
    root: fileURLToPath(new URL(".", import.meta.url)),
    plugins: [react()],
    envDir: fileURLToPath(new URL("../..", import.meta.url)),
    server: {
      // Bind the loopback address the API adapter and the browser journey
      // both use, so a localhost/::1 mismatch cannot make the pair disagree.
      host: "127.0.0.1",
      port: webPort,
      strictPort: true,
      proxy: { "/api": { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false } },
    },
    preview: { host: "127.0.0.1", port: webPort, strictPort: true },
    build: { outDir: "dist", sourcemap: true },
  };
});
