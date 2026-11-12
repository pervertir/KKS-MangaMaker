import Preferences from "../ui/Preferences.svelte";
import { dialog } from "../ui/mount.ts";

/* ================================================================ preferences */
export function preferencesDialog() { dialog(Preferences, "Preferences", "small"); }
