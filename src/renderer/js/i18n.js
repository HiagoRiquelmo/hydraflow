// Traduções na janela. O dicionário vem do processo principal (src/common/i18n.js lê src/locales/<idioma>/*.json).
// Uso: t("area.nome"), t("area.contagem", { n: 3 }). Trocar o idioma emite 'lang' e a interface se redesenha.
import { app, emit, BUILTIN } from './state.js';

let lang = 'pt-BR', dict = {}, base = {}, langs = [];

export async function initI18n() { apply(await window.api.i18n.get()); }

function apply(r) {
  ({ lang, dict, base, langs } = r);
  document.documentElement.lang = lang;
  // textos fixos do index.html: data-i18n (conteúdo), data-i18n-title (title e aria-label)
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle); el.setAttribute('aria-label', el.title); });
  document.querySelectorAll('[data-i18n-label]').forEach(el => el.setAttribute('aria-label', t(el.dataset.i18nLabel)));
}

/** Texto traduzido (mesma regra do processo principal: plural por `n`, variáveis entre chaves). */
export function t(key, vars, fallback) {
  let s = dict[key] ?? base[key];
  if (s && typeof s === 'object') s = s[new Intl.PluralRules(lang).select(Number(vars?.n ?? 0))] ?? s.other;
  if (typeof s !== 'string') return fallback ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
}

/** Existe tradução para a chave? (para textos opcionais, como os parâmetros dos efeitos que vêm com o app) */
export const has = key => key in dict || key in base;

export const currentLang = () => lang;
export const languages = () => langs;

/** Troca o idioma do app inteiro (janela, bandeja, motor) e guarda a escolha. */
export async function setLanguage(id) {
  apply(await window.api.i18n.set(id));
  // a cópia local do store também (Ajustes grava o objeto "app" inteiro: não pode voltar ao idioma antigo)
  if (app.store) app.store.app = { ...(app.store.app || {}), language: lang };
  emit('lang', lang);
}

// efeitos que vêm com o app e têm tradução (nome, descrição e parâmetros em fx.json, sob este prefixo)
const FX_SCOPES = { [BUILTIN.solid]: 'solid', [BUILTIN.screen]: 'screen' };
/** Prefixo de tradução de um efeito (só os que vêm com o app); efeitos baixados ou do usuário usam o próprio texto. */
export const fxScope = fx => (fx ? FX_SCOPES[fx.id] || null : null);
// texto traduzido de um efeito: os que vêm com o app (fx.<prefixo>.*) e os do pacote do Descobrir (extras.<id>.*,
// também depois de baixados: o principal marca extrasId); os demais aparecem como o autor escreveu
function fxText(fx, field) {
  const s = fxScope(fx);
  if (s && has(`fx.${s}.${field}`)) return t(`fx.${s}.${field}`);
  if (fx?.extrasId && has(`extras.${fx.extrasId}.${field}`)) return t(`extras.${fx.extrasId}.${field}`);
  return fx?.[field];
}
/** Nome mostrado de um efeito. */
export const fxName = fx => fxText(fx, 'name');
/** Descrição mostrada de um efeito. */
export const fxDescription = fx => fxText(fx, 'description');
/** Nome/descrição de um item do Descobrir (os do pacote que vem com o app têm tradução). */
export const catalogText = (item, field) => (item.bundled && has(`extras.${item.id}.${field}`) ? t(`extras.${item.id}.${field}`) : item[field]);

// plugins que vêm com o app: os parâmetros deles têm tradução em fx.json sob este prefixo (plugins de terceiros usam o próprio texto)
const PLUGIN_SCOPES = { 'ASUS_Aura_USB.js': 'asus', 'Wooting_Keyboard.js': 'wooting' };
export const pluginScope = dev => PLUGIN_SCOPES[String(dev?.plugin?.file || '').split(/[\\/]/).pop()] || null;
/** Dica (tooltip) de um parâmetro: traduzida para efeitos/plugins do app, senão a do próprio arquivo. */
export function paramHint(p, scope) {
  return scope && has(`fx.${scope}.${p.property}.hint`) ? t(`fx.${scope}.${p.property}.hint`) : (p.description || p.tooltip || '');
}

/** Nome mostrado de uma categoria de efeitos (as do app e do Descobrir têm tradução; outras aparecem como vieram). */
export const categoryLabel = c => (c && has(`categories.${c}`) ? t(`categories.${c}`) : c);

/** Rótulo de um parâmetro de efeito/plugin: os efeitos que vêm com o app têm tradução; os outros usam o próprio texto. */
export function paramLabel(p, scope) {
  return scope && has(`fx.${scope}.${p.property}`) ? t(`fx.${scope}.${p.property}`) : (p.label || p.property);
}
/** Texto de uma opção de lista de um parâmetro (o valor guardado não muda; só o que aparece). */
export function paramValue(p, v, scope) {
  return scope && has(`fx.${scope}.${p.property}.${v}`) ? t(`fx.${scope}.${p.property}.${v}`) : String(v);
}

/** Números e datas no formato do idioma. */
export const fmtNumber = (n, opts) => new Intl.NumberFormat(lang, opts).format(n);
