'use strict';
// Componentes ARGB (fans, fitas, anéis) do usuário, em arquivos JSON:
// { ProductName, DisplayName, Brand, Type, LedCount, Width, Height, LedMapping[], LedCoordinates[[x,y]], LedNames[], ImageUrl }
// Os genéricos (anéis e fitas) são gerados pela interface (renderer/js/components.js).
const fs = require('fs');
const path = require('path');

function validate(c) {
  return c && Array.isArray(c.LedCoordinates) && c.LedCoordinates.length > 0 &&
    Number.isFinite(c.Width) && Number.isFinite(c.Height);
}

function loadFolder(dir, out) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) loadFolder(p, out);
    else if (e.name.toLowerCase().endsWith('.json')) {
      try {
        const c = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (validate(c)) {
          c.LedCount = c.LedCoordinates.length;
          if (!Array.isArray(c.LedMapping) || c.LedMapping.length !== c.LedCount) c.LedMapping = c.LedCoordinates.map((_, i) => i);
          if (!Array.isArray(c.LedNames)) c.LedNames = c.LedCoordinates.map((_, i) => `Led ${i + 1}`);
          c.DisplayName = c.DisplayName || c.ProductName || path.basename(p, '.json');
          c.Brand = c.Brand || 'Desconhecida';
          c.Type = c.Type || 'Outro';
          out.push(c);
        }
      } catch {}
    }
  }
}

function listComponents(folders) {
  const out = [];
  for (const f of folders) loadFolder(f, out);
  return out;
}

module.exports = { listComponents };
