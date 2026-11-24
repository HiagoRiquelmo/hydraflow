'use strict';
// Verificação rápida sem hardware: cada plugin incluído carrega, inicializa e renderiza;
// cada efeito incluído é lido com parâmetros válidos. Sai com código 1 se algo falhar.
// Uso: node scripts/check.js [pasta-de-plugins-extra]   (a pasta extra só é lida, não executada)
const path = require('path');
const fs = require('fs');
const { PluginInstance, probePlugin, nullIo } = require('../src/engine/pluginHost');
const { walkPlugins } = require('../src/engine/discovery');
const { EffectCatalog } = require('../src/main/effects');

const root = path.join(__dirname, '..');
const failures = [];
const fail = (what, why) => { failures.push(what); console.log('ERRO', what, '—', why); };

function runPlugin(file) {
  const meta = probePlugin(file, { motherboard: 'TESTE' });
  const inst = new PluginInstance({ file, io: nullIo(), systemInfo: {}, log: () => {} });
  inst.initialize();
  const d = inst.descriptor();
  if (!(d.size[0] >= 1 && d.size[1] >= 1)) throw new Error(`tamanho inválido ${d.size}`);
  if (d.ledPositions.some(([x, y]) => x < 0 || y < 0 || x >= d.size[0] || y >= d.size[1])) throw new Error('LED fora da grade');
  inst.frame = { device: { w: d.size[0], h: d.size[1], data: new Uint8Array(d.size[0] * d.size[1] * 3).fill(200) }, subs: {}, channels: {} };
  for (const c of d.channels) inst.frame.channels[c.name] = new Uint8Array(30).fill(100);
  inst.render();
  console.log('OK ', meta.name, '| tipo', meta.type, '| tam', d.size, '| leds', d.ledPositions.length, '| canais', d.channels.map(c => c.name).join(',') || '-');
}

for (const file of walkPlugins(path.join(root, 'plugins'))) {
  try { runPlugin(file); } catch (e) { fail(path.basename(file), e.message); }
}

const extra = process.argv[2];
if (extra) {
  const types = {};
  for (const f of walkPlugins(extra)) { try { const m = probePlugin(f, {}); types[m.type] = (types[m.type] || 0) + 1; } catch (e) { console.log('aviso', path.basename(f), e.message); } }
  console.log('Tipos na pasta extra:', types);
}

const TYPES = { number: 'number', hue: 'number', boolean: 'boolean', color: 'string', combobox: 'string', textfield: 'string' };
const effectsDir = path.join(root, 'effects');
const files = fs.readdirSync(effectsDir, { recursive: true }).filter(f => /\.html?$/i.test(f));
const effects = new EffectCatalog([{ key: 'builtin', dir: effectsDir }]).scan();
if (effects.length !== files.length) fail('efeitos', `${files.length} arquivos, ${effects.length} lidos`);

// pacote do Descobrir (efeitos-extras): índice coerente, arquivos e capas existem, ids únicos
const exDir = path.join(root, 'efeitos-extras');
const idx = JSON.parse(fs.readFileSync(path.join(exDir, 'index.json'), 'utf8'));
const seen = new Set();
for (const e of idx.effects) {
  if (!e.id || !e.name || !e.file) { fail(`extras.${e.id || '?'}`, 'faltando id/name/file'); continue; }
  if (seen.has(e.id)) fail(`extras.${e.id}`, 'id repetida');
  seen.add(e.id);
  if (!fs.existsSync(path.join(exDir, e.file))) fail(`extras.${e.id}`, `arquivo ${e.file} não existe`);
  if (e.image && !fs.existsSync(path.join(exDir, e.image))) fail(`extras.${e.id}`, `capa ${e.image} não existe`);
}
const extras = new EffectCatalog([{ key: 'extras', dir: path.join(exDir, 'efeitos') }]).scan();
if (extras.length !== idx.effects.length) fail('extras', `${idx.effects.length} no índice, ${extras.length} lidos`);
console.log(`Descobrir: ${idx.effects.length}`);

for (const e of [...effects, ...extras]) {
  for (const p of e.properties) {
    const want = TYPES[p.type];
    if (want && typeof p.default !== want) fail(`${e.name}.${p.property}`, `padrão ${JSON.stringify(p.default)} não é ${want}`);
    if (p.type === 'combobox' && !p.values?.includes(p.default)) fail(`${e.name}.${p.property}`, `padrão fora da lista de valores`);
  }
}
console.log(`Efeitos: ${effects.length}`);

// protocolo da tela Gamdias: moldura, soma, escape e pedaços HID (valores conferidos com o código do ZEUS CAST)
{
  const lcd = require('../src/main/coolerLcd');
  const f = lcd.frame('POST conn\r\n\r\n');
  const expect = Buffer.from([0x5A, 0x00, 13 + 5, ...Buffer.from('POST conn\r\n\r\n'), 0, 0x5A]); // tamanho = texto + 5
  let sum = 0; for (let i = 1; i < expect.length - 2; i++) sum += expect[i]; expect[expect.length - 2] = sum & 0xff;
  if (!f.equals(expect)) fail('tela.moldura', f.toString('hex'));
  const esc = lcd.frame('Z['); // 0x5A e 0x5B no meio viram 5B 01 / 5B 02
  if (!esc.subarray(3, 7).equals(Buffer.from([0x5B, 0x01, 0x5B, 0x02]))) fail('tela.escape', esc.toString('hex'));
  if (lcd.command('brightness', { value: 80 }) !== 'POST brightness 1\r\nContentType=json\r\nContentLength=12\r\n\r\n{"value":80}') fail('tela.comando', 'texto diferente');
  const chunks = lcd.hidRealtimeChunks(Buffer.alloc(2500, 7));
  if (chunks.length !== 3 || chunks[0][0] !== 0x5C || chunks[0].readUInt16BE(1) !== 1021 || chunks[2].readUInt16BE(6) !== 2 || chunks[1].readUInt16BE(4) !== 3 || chunks[2].length !== 24 + 500) fail('tela.hid', 'pedaços errados');
  if (lcd.hidReports(Buffer.alloc(1500)).length !== 2) fail('tela.relatorios', 'contagem');
  // respostas da tela: bytes reais do AURA GL360 LCD (fw V1.2.7) ao "POST power", e uma com JSON e "[" escapado
  const real = lcd.parseReply(Buffer.from('5a001b31203230300d0a41636b4e756d6265723d310d0a0d0a295a', 'hex'));
  if (real?.reply.status !== 200 || real.reply.seq !== 1 || real.reply.headers.AckNumber !== '1') fail('tela.resposta', JSON.stringify(real));
  const body = '{"attribute":["Status"],"version":{"firmware":"V1.2.7"}}';
  const withJson = lcd.frame(`0 200\r\nAckNumber=1\r\nContentType=json\r\nContentLength=${body.length}\r\n\r\n${body}`);
  const parsed = lcd.parseReply(Buffer.concat([Buffer.from([1, 2]), withJson, Buffer.from([0x5A])])); // lixo antes e começo da próxima depois
  if (parsed?.reply.json?.version?.firmware !== 'V1.2.7' || parsed.rest.length !== 1) fail('tela.resposta.json', JSON.stringify(parsed?.reply));
  const broken = Buffer.from(withJson); broken[broken.length - 2] ^= 0xff;
  if (lcd.parseReply(broken)?.reply.error !== 'checksum') fail('tela.resposta.soma', 'soma errada aceita');
  if (lcd.parseReply(withJson.subarray(0, 20)) !== null) fail('tela.resposta.parcial', 'resposta incompleta não pode ser lida');
  console.log('Protocolo da tela: ok');
}

// idiomas: toda chave usada no código existe em pt-BR; en e es têm as mesmas chaves, as mesmas variáveis e as
// formas de plural; e nenhum texto em português ficou fixo no código da interface (fora de comentários)
{
  const { loadDict, LANGS, DEFAULT_LANG } = require('../src/common/i18n');
  const base = loadDict(DEFAULT_LANG);
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : /\.(js|html)$/.test(e.name) ? [path.join(d, e.name)] : []);
  const srcFiles = walk(path.join(__dirname, '..', 'src'));
  const used = new Set();
  for (const f of srcFiles) {
    const code = fs.readFileSync(f, 'utf8');
    for (const m of code.matchAll(/\b(?:t|i18n\.t|tr)\(\s*'([a-zA-Z][\w-]*\.[\w.-]+)'/g)) used.add(m[1]);
    for (const m of code.matchAll(/data-i18n(?:-title|-label)?="([\w.]+)"/g)) used.add(m[1]);
  }
  for (const k of used) if (!(k in base)) fail('idioma.chave', `${k} não existe em ${DEFAULT_LANG}`);
  // todo efeito do pacote do Descobrir tem nome e descrição traduzíveis (locales/*/extras.json)
  for (const e of require('../efeitos-extras/index.json').effects) {
    if (!(`extras.${e.id}.name` in base) || !(`extras.${e.id}.description` in base)) fail('idioma.extras', `efeito ${e.id} sem tradução`);
  }
  const vars = v => JSON.stringify([...new Set(JSON.stringify(v).match(/\{\w+\}/g) || [])].sort());
  for (const { id } of LANGS.filter(l => l.id !== DEFAULT_LANG)) {
    const d = loadDict(id);
    for (const k of Object.keys(base)) {
      if (!(k in d)) { fail('idioma.' + id, `falta ${k}`); continue; }
      if (vars(d[k]) !== vars(base[k])) fail('idioma.' + id, `variáveis diferentes em ${k}`);
      if (typeof base[k] === 'object' && (typeof d[k] !== 'object' || !d[k].other)) fail('idioma.' + id, `plural incompleto em ${k}`);
    }
    for (const k of Object.keys(d)) if (!(k in base)) fail('idioma.' + id, `chave sobrando ${k}`);
  }
  // texto fixo: string com acento do português dentro do código da janela (comentários e console ignorados)
  const leftovers = [];
  for (const f of srcFiles.filter(f => /renderer[\\/]js/.test(f))) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (/i18n-dado/.test(line)) return; // valor guardado (sempre o mesmo em qualquer idioma), traduzido só ao mostrar
      const code = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
      if (/console\.|^\s*\*/.test(code)) return;
      if (/(['"`])[^'"`]*[ãõçáéíóúâêôà][^'"`]*\1/i.test(code)) leftovers.push(`${path.relative(path.join(__dirname, '..'), f)}:${i + 1}`);
    });
  }
  if (leftovers.length) fail('idioma.textoFixo', `${leftovers.length} linha(s): ${leftovers.slice(0, 12).join(', ')}${leftovers.length > 12 ? '…' : ''}`);
  console.log(`Idiomas: ${Object.keys(base).length} textos, ${used.size} chaves usadas`);
}

// mensagens do motor (src/engine/protocol.js): o motor só manda tipos declarados, a janela só pede comandos
// declarados, e todo comando declarado existe no motor
{
  const { STATE_MESSAGES, EVENT_MESSAGES, UI_COMMANDS } = require('../src/engine/protocol');
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : /\.js$/.test(e.name) ? [path.join(d, e.name)] : []);
  const declared = new Set([...STATE_MESSAGES, ...EVENT_MESSAGES]);
  const engineDir = path.join(__dirname, '..', 'src', 'engine');
  for (const f of walk(engineDir)) {
    const code = fs.readFileSync(f, 'utf8');
    for (const m of code.matchAll(/\bsend\(\s*'(\w+)'|statusHolder\([^,]+,\s*'(\w+)'/g)) {
      const type = m[1] || m[2];
      if (!declared.has(type)) fail('motor.mensagem', `${path.basename(f)} manda '${type}', que não está em protocol.js`);
    }
  }
  const engineCode = fs.readFileSync(path.join(engineDir, 'engine.js'), 'utf8');
  for (const c of UI_COMMANDS) if (!new RegExp(`^\\s{2}${c}[(:]`, 'm').test(engineCode)) fail('motor.comando', `'${c}' declarado, mas o motor não trata`);
  for (const f of walk(path.join(__dirname, '..', 'src', 'renderer', 'js'))) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/engine\.cmd\(\s*'(\w+)'/g)) {
      if (!UI_COMMANDS.includes(m[1])) fail('motor.comando', `${path.basename(f)} pede '${m[1]}', que não está em UI_COMMANDS`);
    }
  }
  console.log(`Mensagens do motor: ${declared.size} tipos, ${UI_COMMANDS.length} comandos da janela`);
}

console.log(failures.length ? `\nFalhas: ${failures.length}` : '\nTudo OK');
process.exitCode = failures.length ? 1 : 0;
