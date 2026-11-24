'use strict';
// Converte um módulo ES de plugin em script executável num contexto vm.
// - "export function X" -> "function X" + registro em __exports
// - imports "@SignalRGB/...", "@rgb/...", "@RGBStudio/..." e "@Hydraflow/..." -> módulos internos (shims)
// - imports relativos -> carregados via __require

function transformModule(source) {
  const exported = new Set();
  let code = source.replace(/^﻿/, '');

  code = code.replace(/import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["'];?/g, (_, names, from) => {
    const list = names.split(',').map(s => s.trim()).filter(Boolean)
      .map(s => s.replace(/\s+as\s+/, ': '));
    return `const { ${list.join(', ')} } = __require(${JSON.stringify(from)});`;
  });
  code = code.replace(/import\s+([A-Za-z_$][\w$]*)\s+from\s*["']([^"']+)["'];?/g,
    (_, name, from) => `const ${name} = __require(${JSON.stringify(from)}).default ?? __require(${JSON.stringify(from)});`);
  code = code.replace(/import\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s+from\s*["']([^"']+)["'];?/g,
    (_, name, from) => `const ${name} = __require(${JSON.stringify(from)});`);

  code = code.replace(/export\s+default\s+(class|function)\s+([A-Za-z_$][\w$]*)/g, (m, kind, name) => { exported.add(`default=${name}`); return `${kind} ${name}`; });
  code = code.replace(/export\s+default\s+/g, '__exports.default = ');
  code = code.replace(/export\s+(async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/g, (m, a, name) => { exported.add(name); return `${a || ''}function ${name}`; });
  code = code.replace(/export\s+class\s+([A-Za-z_$][\w$]*)/g, (m, name) => { exported.add(name); return `class ${name}`; });
  code = code.replace(/export\s+(const|let|var)\s+([A-Za-z_$][\w$]*)/g, (m, kind, name) => { exported.add(name); return `${kind} ${name}`; });
  code = code.replace(/export\s*\{([^}]*)\};?/g, (_, names) => {
    for (const n of names.split(',').map(s => s.trim()).filter(Boolean)) {
      const [local, alias] = n.split(/\s+as\s+/);
      exported.add(alias ? `${alias}=${local}` : local);
    }
    return '';
  });

  const tail = [...exported].map(n => {
    const [alias, local] = n.includes('=') ? n.split('=') : [n, n];
    return `try { __exports[${JSON.stringify(alias)}] = ${local}; } catch (e) {}`;
  }).join('\n');
  return { code: `${code}\n;${tail}\n` };
}

module.exports = { transformModule };
