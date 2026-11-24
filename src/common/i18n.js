'use strict';
// Traduções do Hydraflow para o processo principal, o motor e o auxiliar de memória (a janela recebe o mesmo
// dicionário pelo preload — ver src/renderer/js/i18n.js). Os textos ficam em src/locales/<idioma>/<área>.json;
// a chave é "<área>.<nome>" (ex.: "cooler.busy"). pt-BR é o padrão e a reserva de toda chave que faltar.
//
// Formato de um texto:
//   "Olá, {nome}"                          → variáveis entre chaves
//   { "one": "{n} item", "other": "{n} itens" } → plural pela variável n (Intl.PluralRules)
const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.join(__dirname, '..', 'locales');
const DEFAULT_LANG = 'pt-BR';
/** Idiomas oferecidos, com o nome de cada um no próprio idioma. */
const LANGS = [
  { id: 'pt-BR', name: 'Português (Brasil)' },
  { id: 'en', name: 'English' },
  { id: 'es', name: 'Español' }
];

const cache = new Map();
/** Dicionário plano { "area.nome": texto } de um idioma. */
function loadDict(lang) {
  if (cache.has(lang)) return cache.get(lang);
  const dir = path.join(LOCALES_DIR, lang), dict = {};
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    if (!f.endsWith('.json')) continue;
    const ns = f.slice(0, -5);
    const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const [k, v] of Object.entries(data)) dict[`${ns}.${k}`] = v;
  }
  cache.set(lang, dict);
  return dict;
}

const normalize = lang => (LANGS.some(l => l.id === lang) ? lang : DEFAULT_LANG);

/** Texto pronto: escolhe o plural (se houver) e troca as variáveis. Mesma regra da janela. */
function format(entry, vars, lang) {
  let s = entry;
  if (s && typeof s === 'object') s = s[new Intl.PluralRules(lang).select(Number(vars?.n ?? 0))] ?? s.other;
  if (typeof s !== 'string') return null;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
}

/** Tradutor de um idioma: t(chave, variáveis?, reserva?) — a reserva é usada se a chave não existir em lugar nenhum. */
function createI18n(lang) {
  lang = normalize(lang);
  const dict = loadDict(lang), base = loadDict(DEFAULT_LANG);
  const t = (key, vars, fallback) => format(dict[key] ?? base[key], vars, lang) ?? fallback ?? key;
  return { lang, t, dict, base };
}

/** Idioma salvo no config.json (para quem não tem o Store, como o auxiliar elevado). */
function langFromConfig(dataDir) {
  try { return normalize(JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8')).app?.language); } catch { return DEFAULT_LANG; }
}

module.exports = { LANGS, DEFAULT_LANG, LOCALES_DIR, createI18n, loadDict, format, langFromConfig, normalize };
