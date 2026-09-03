import mermaid from 'mermaid';
import fs from 'node:fs';

const src = fs.readFileSync(process.argv[2], 'utf8');
// Extract first ```mermaid ... ``` block
const m = src.match(/```mermaid\n([\s\S]*?)\n```/);
if (!m) { console.error("no mermaid block found"); process.exit(2); }
const code = m[1];

try {
  await mermaid.parse(code);
  console.log("OK: mermaid parses cleanly");
} catch (e) {
  console.error("FAIL:", e.message);
  process.exit(1);
}
