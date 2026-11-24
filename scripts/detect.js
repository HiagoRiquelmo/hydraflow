'use strict';
// Simula a detecção sem enviar nada ao hardware: lista dispositivos HID e qual plugin seria usado.
// Uso: node scripts/detect.js <pasta-de-plugins> [...]
const HID = require('node-hid');
const { probePlugin } = require('../src/engine/pluginHost');
const { walkPlugins, enumerateHid, groupEndpoints, candidatesFor, chooseEndpoint } = require('../src/engine/discovery');

const catalog = [];
for (const f of process.argv.slice(2).flatMap(d => walkPlugins(d))) { try { const m = probePlugin(f, {}); if (m.type === 'hid') catalog.push(m); } catch {} }

const groups = groupEndpoints(enumerateHid(HID));
console.log(`${catalog.length} plugins HID; ${groups.size} dispositivos HID físicos\n`);
for (const [gid, eps] of groups) {
  const cands = candidatesFor(catalog, eps);
  let match = null;
  for (const m of cands) {
    const ep = chooseEndpoint(m, eps, {});
    if (ep) { match = `${m.name}  [interface ${ep.interface}, usage_page 0x${ep.usage_page.toString(16)}]`; break; }
  }
  console.log(`${gid}  ${eps[0].product || ''}\n   -> ${match || (cands.length ? 'plugin encontrado, mas nenhuma interface validou' : 'sem plugin')}`);
}
