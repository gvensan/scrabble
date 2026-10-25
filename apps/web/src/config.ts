const viteEnv = import.meta.env as Record<string, unknown>;
const configuredApi = viteEnv.VITE_API_BASE_URL;
const configuredWs = viteEnv.VITE_WS_BASE_URL;
export const api =
  typeof configuredApi === "string" ? configuredApi : "http://localhost:8787";
export const wsBase =
  typeof configuredWs === "string" ? configuredWs : api.replace(/^http/, "ws");
