// Les fonctions edge importent supabase-js par URL (Deno). Sous Node,
// on le remplace par le faux client de harness.mjs.
import { register } from "node:module";

register("./resolve.mjs", import.meta.url);
