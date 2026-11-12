import ExpressionDialog from "../ui/ExpressionDialog.svelte";
import SaveAsset from "../ui/SaveAsset.svelte";
import { dialog } from "../ui/mount.ts";
import { toast } from "../editor/misc.js";
import { draftFromRender, draftFromSelection, lib, loadLibrary, type LibAsset } from "./library.ts";

async function ready() { if (!lib.loaded) await loadLibrary(); }

export async function saveSelectionDialog() {
  const d = draftFromSelection();
  if (!d) return toast("Select a layer or a panel first");
  await ready();
  dialog(SaveAsset, "Save to asset library", "small", { draft: d });
}
export async function saveRenderDialog(ref: string, shot = "") {
  await ready();
  dialog(SaveAsset, "Save to asset library", "small", { draft: draftFromRender(ref, shot) });
}
export async function editAssetDialog(asset: LibAsset) {
  await ready();
  dialog(SaveAsset, "Edit asset", "small", { asset });
}
export function expressionDialog(shot: string, ref: string) {
  if (!shot) return toast("This picture has no shot, so there is no character to repaint");
  dialog(ExpressionDialog, "New expression", "small", { shot, ref });
}
