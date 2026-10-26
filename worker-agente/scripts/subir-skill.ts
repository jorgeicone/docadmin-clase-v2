// Sube una skill propia (carpeta con SKILL.md) a la Skills API de Anthropic.
// Uso:  ANTHROPIC_API_KEY=... npx tsx scripts/subir-skill.ts ruta/a/mi-skill
// Luego agrega el id que imprime a CUSTOM_SKILL_IDS en wrangler.toml y despliega.
// Para publicar una versión nueva de una skill existente:
//        npx tsx scripts/subir-skill.ts ruta/a/mi-skill skill_01...
import Anthropic, { toFile } from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";

const [carpeta, skillId] = process.argv.slice(2);
if (!carpeta || !fs.existsSync(path.join(carpeta, "SKILL.md"))) {
  console.error("Indica una carpeta que contenga SKILL.md");
  process.exit(1);
}

const raiz = path.basename(path.resolve(carpeta));
const archivos: string[] = [];
const recorrer = (dir: string) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) recorrer(p); else archivos.push(p);
  }
};
recorrer(carpeta);

const client = new Anthropic();
const files = await Promise.all(archivos.map((p) =>
  toFile(fs.createReadStream(p), path.join(raiz, path.relative(carpeta, p)).split(path.sep).join("/"))));

if (skillId) {
  const v = await client.skills.versions.create(skillId, { files });
  console.log(`Nueva versión de ${skillId}: ${v.id}`);
} else {
  const s = await client.skills.create({ files });
  console.log(`Skill creada: ${s.id}  (versión ${s.latest_version_id})`);
}
