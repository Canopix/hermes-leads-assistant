import mermaid from 'mermaid';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.navigator = dom.window.navigator;

import fs from 'node:fs';
const src = fs.readFileSync(process.argv[2], 'utf8');
const m = src.match(/```mermaid\n([\s\S]*?)\n```/);
const code = m[1];

try {
  await mermaid.parse(code);
  console.log("OK");
} catch (e) {
  console.error("PARSE FAIL:", e.message);
  process.exit(1);
}
