// Componentes ARGB genéricos (anéis e fitas). Os do usuário vêm de arquivos .json (main/components.js).
import { uid, toast } from './ui.js';
import { t } from './i18n.js';

function makeComponent(name, type, width, height, coords) {
  return {
    ProductName: name, DisplayName: name, Brand: 'Genérico', Type: type, // i18n-dado
    LedCount: coords.length, Width: width, Height: height,
    LedMapping: coords.map((_, i) => i), LedCoordinates: coords,
    LedNames: coords.map((_, i) => `Led ${i + 1}`), ImageUrl: ''
  };
}

function ring(count, size) {
  const c = (size - 1) / 2;
  return Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2 - Math.PI / 2;
    return [Math.round(c + Math.cos(a) * c), Math.round(c + Math.sin(a) * c)];
  });
}

const line = n => Array.from({ length: n }, (_, i) => [i, 0]);

// O nome dos genéricos fica gravado nos canais (DisplayName, em português, como sempre foi); o texto mostrado sai
// do idioma escolhido, reconhecendo o nome — vale também para configurações salvas antes da tradução.
const GENERIC = [
  [/^Anel genérico - (\d+) LEDs$/, 'components.ring'],
  [/^Fan anel duplo - (\d+) LEDs$/, 'components.doubleRing'],
  [/^Fita genérica - (\d+) LEDs$/, 'components.strip'],
  [/^Fita personalizada - (\d+) LEDs$/, 'components.customStrip'],
  [/^Fita padrão - (\d+)$/, 'components.defaultStrip']
];

export function builtinComponents() {
  const list = [];
  for (const n of [8, 12, 16, 18, 24, 32]) {
    const size = n <= 12 ? 7 : n <= 18 ? 9 : 11;
    list.push(makeComponent(`Anel genérico - ${n} LEDs`, 'Fan', size, size, ring(n, size))); // i18n-dado
  }
  const inner = ring(12, 7).map(([x, y]) => [x + 2, y + 2]);
  list.push(makeComponent('Fan anel duplo - 36 LEDs', 'Fan', 11, 11, [...ring(24, 11), ...inner]));
  for (const n of [10, 20, 30, 40, 60]) list.push(makeComponent(`Fita genérica - ${n} LEDs`, 'Strip', n, 1, line(n))); // i18n-dado
  return list;
}

/** Uma instância nova (pronta para entrar numa cadeia de canal) de um componente do catálogo. */
export const instantiate = c => ({ ...structuredClone(c), instanceId: uid() });

export function customStrip(count) {
  const n = Math.max(1, Math.min(1000, Math.floor(count)));
  return instantiate(makeComponent(`Fita personalizada - ${n} LEDs`, 'Strip', n, 1, line(n)));
}

/** Marcador para canais ARGB ainda não configurados (conectores ARGB não informam o que está ligado neles). */
export function defaultStrip(ledLimit) {
  const n = Math.min(ledLimit > 0 ? ledLimit : 60, 60);
  return { ...instantiate(makeComponent(`Fita padrão - ${n}`, 'Strip', n, 1, line(n))), isDefault: true }; // i18n-dado
}

export const onlyDefaults = chain => chain.length > 0 && chain.every(c => c.isDefault);

/** O primeiro componente real escolhido substitui o marcador automático. */
export function replaceDefaults(chain) {
  if (onlyDefaults(chain)) { chain.length = 0; toast(t('components.defaultReplaced')); }
}

/** Nome mostrado: apelido dado pela pessoa, nome traduzido (genéricos do app) ou o nome do arquivo .json. */
export function componentLabel(c) {
  if (c.alias) return c.alias;
  for (const [re, key] of GENERIC) { const m = re.exec(c.DisplayName || ''); if (m) return t(key, { n: m[1] }); }
  return c.DisplayName;
}

/** Marca mostrada ("Genérico" nos do app). */
export const componentBrand = c => (c.Brand === 'Genérico' ? t('components.generic') : c.Brand); // i18n-dado
