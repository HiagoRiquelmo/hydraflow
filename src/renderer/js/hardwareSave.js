// "Salvar no dispositivo": grava o que está tocando na memória do próprio hardware (continua com o app fechado).
// Quem decide se um dispositivo grava (e de que jeitos) é o motor (hardwareSave em cada dispositivo publicado:
// { supported, modes } ou { supported: false, reason }); aqui só se escolhe e se mostra o resultado.
import { app, on, deviceName } from './state.js';
import { h, modal, toast } from './ui.js';
import { t, has } from './i18n.js';

/** Pede ao motor para gravar um dispositivo; resolve com { ok, error?, detail? } (ou erro de tempo esgotado). */
function saveOne(id, mode) {
  return new Promise(resolve => {
    const timer = setTimeout(() => { off(); resolve({ ok: false, error: t('engine.saveFailed') }); }, 15000);
    const off = on('hardwareSaveResult', r => { if (r.id !== id) return; clearTimeout(timer); off(); resolve(r); });
    window.api.engine.cmd('hardwareSave', { id, mode });
  });
}

export async function hardwareSaveDialog() {
  const devs = [...app.devices.values()].filter(d => !d.virtual && d.status !== 'disabled');
  const rows = [];
  const list = h('div', { class: 'col', style: { gap: '8px', width: 'min(640px, 80vw)' } });
  if (!devs.length) list.append(h('div', { class: 'dim' }, t('hwsave.none')));
  for (const d of devs) {
    const cap = d.hardwareSave || { supported: false, reason: 'other' };
    if (!cap.supported) {
      const reason = has(`hwsave.reason.${cap.reason}`) ? t(`hwsave.reason.${cap.reason}`) : t('hwsave.reason.other');
      list.append(h('div', { class: 'pl-row', style: { opacity: 0.7, alignItems: 'flex-start' } },
        h('input', { type: 'checkbox', disabled: true, 'aria-label': deviceName(d) }),
        h('div', { class: 'grow' }, h('div', {}, deviceName(d)), h('div', { class: 'dim' }, reason))));
      continue;
    }
    const check = h('input', { type: 'checkbox', checked: true, 'aria-label': deviceName(d) });
    const sel = h('select', { class: 'input', 'aria-label': t('hwsave.mode') }, cap.modes.map(m => h('option', { value: m }, has(`hwsave.mode.${m}`) ? t(`hwsave.mode.${m}`) : m)));
    rows.push({ d, check, sel });
    list.append(h('div', { class: 'pl-row' }, check,
      h('div', { class: 'grow' }, h('div', {}, deviceName(d)), h('div', { class: 'dim' }, t('hwsave.supported'))), sel));
  }
  const body = h('div', { class: 'col', style: { gap: '12px' } },
    h('div', { class: 'muted', style: { maxWidth: '640px' } }, t('hwsave.intro')), list,
    rows.length ? h('div', { class: 'dim', style: { maxWidth: '640px' } }, t('hwsave.warning')) : null);
  const go = await modal(t('hwsave.title'), body, [
    { label: t('common.cancel'), value: () => false },
    ...(rows.length ? [{ label: t('hwsave.save'), primary: true, value: () => (rows.some(r => r.check.checked) ? true : (toast(t('hwsave.pickOne'), 'err'), undefined)) }] : [])
  ]);
  if (!go) return;
  toast(t('hwsave.saving'));
  for (const r of rows.filter(r => r.check.checked)) {
    const res = await saveOne(r.d.id, r.sel.value);
    toast(res.ok ? t('hwsave.done', { name: deviceName(r.d) }) : t('hwsave.failed', { name: deviceName(r.d), error: res.error }), res.ok ? '' : 'err');
  }
}
