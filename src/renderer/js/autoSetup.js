// Configuração automática: canais ARGB sem configuração recebem uma fita padrão (marcador),
// como faz o SignalRGB. É uma estimativa que o usuário refina na aba Componentes.
import { app, on, set, deviceSettings, saveDevice, emit } from './state.js';
import { defaultStrip, onlyDefaults } from './components.js';
import { currentItems, invalidateItems } from './sampler.js';
import { autoArrange } from './layoutModel.js';

export function channelsUsingDefaults(dev) {
  const s = deviceSettings(dev.id);
  return (dev.descriptor?.channels || []).filter(ch => onlyDefaults(s.channels[ch.name] || []));
}

function ensureDefaults() {
  let changed = false;
  for (const dev of app.devices.values()) {
    const chans = dev.descriptor?.channels;
    if (!chans?.length) continue;
    const s = deviceSettings(dev.id);
    let devChanged = false;
    for (const ch of chans) {
      if (s.channels[ch.name] === undefined) { s.channels[ch.name] = [defaultStrip(ch.ledLimit)]; devChanged = true; }
    }
    if (devChanged) { saveDevice(dev.id); changed = true; }
  }
  if (changed) emit('devices');
}

// No primeiro uso, organiza o layout automaticamente quando os dispositivos param de chegar.
let arrangeTimer = null;
function scheduleFirstArrange() {
  if (app.store.layouts?.autoArranged) return;
  clearTimeout(arrangeTimer);
  arrangeTimer = setTimeout(() => {
    if (app.engineInfo.loading) return; // 'engineinfo' chega quando os plugins terminam de carregar
    invalidateItems();
    const items = currentItems();
    if (!items.length) return;
    autoArrange(items);
    set('layouts.autoArranged', true, { silent: true });
    emit('layout');
  }, 3000);
}

export function startAutoSetup() {
  on('devices', () => { ensureDefaults(); scheduleFirstArrange(); });
  on('engineinfo', scheduleFirstArrange);
  ensureDefaults();
  scheduleFirstArrange();
}
