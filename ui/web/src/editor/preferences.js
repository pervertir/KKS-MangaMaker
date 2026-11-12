import Preferences from "../ui/Preferences.svelte";
import { dialog } from "../ui/mount.js";

/* ================================================================ preferences */
export function preferencesDialog() { dialog(Preferences, "Preferences", "small"); }
