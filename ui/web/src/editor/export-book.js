import ExportBook from "../ui/ExportBook.svelte";
import { dialog } from "../ui/mount.js";

export function exportBookDialog() { dialog(ExportBook, "Export book", "small"); }
