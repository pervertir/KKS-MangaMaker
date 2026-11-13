import { post } from "./core.js";
import { S } from "./state.ts";

/* Preferences kept by the server (settings.json), so the MCP server follows them too */
export const setting = k => !!S.cat?.settings?.[k];
export async function saveSetting(k, v) {
  const r = await post("/api/settings", { [k]: v });
  if (S.cat) S.cat.settings = r;
  return r;
}
