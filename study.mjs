import { readFile } from "node:fs/promises";
import { runStudy } from "./engine.mjs";

const macro = JSON.parse(await readFile(new URL("./data/macro.json", import.meta.url), "utf8"));
const metros = JSON.parse(await readFile(new URL("./data/metro-hpi.json", import.meta.url), "utf8"));
const scenarios = Number(process.argv[2] ?? 1200);
const stress = Number(process.argv[3] ?? 1);
console.log(JSON.stringify(runStudy({ scenarios, stress, macroHistory: macro.rows, metroHistory: metros.metros }), null, 2));
