// Playlists do usuário (store "playlists": [{ id, name, effects: [effectId] }]): usadas pela aba Efeitos, pela
// Iluminação ("Adicionar à playlist") e pela troca automática (playback.js).
import { app, set, effectById } from './state.js';
import { h, modal, prompt, toast, uid, requiredName } from './ui.js';
import { t, fxName } from './i18n.js';

export const playlists = () => (app.store.playlists ||= []);
export function savePlaylists() { set('playlists', playlists()); }

/** Efeito desinstalado: sai das playlists e dos favoritos. */
export function forgetEffect(id) {
  for (const p of playlists()) p.effects = p.effects.filter(x => x !== id);
  savePlaylists();
  set('favorites', (app.store.favorites || []).filter(x => x !== id));
}

export function deletePlaylist(id) { app.store.playlists = playlists().filter(p => p.id !== id); savePlaylists(); }

/** Nova playlist (pergunta o nome). Devolve a playlist criada ou null. */
export async function createPlaylist(effects = []) {
  const name = await prompt(t('effects.newPlaylist'), { label: t('effects.name'), validate: requiredName });
  if (!name) return null;
  const p = { id: uid(), name, effects };
  playlists().push(p);
  savePlaylists();
  return p;
}

export async function addToPlaylistDialog(effectId) {
  const fx = effectById(effectId);
  const body = h('div', { class: 'col', style: { width: '400px' } });
  const draw = () => {
    body.innerHTML = '';
    if (!playlists().length) body.append(h('div', { class: 'dim' }, t('effects.noPlaylists')));
    for (const p of playlists()) {
      const has = p.effects.includes(effectId);
      body.append(h('div', { class: 'pl-row' }, h('span', { class: 'grow' }, p.name), h('span', { class: 'dim' }, t('effects.effectCount', { n: p.effects.length })),
        h('button', { class: `btn sm ${has ? '' : 'primary'}`, onclick: () => {
          if (has) p.effects = p.effects.filter(e => e !== effectId); else p.effects.push(effectId);
          savePlaylists(); draw();
        } }, has ? t('common.remove') : t('common.add'))));
    }
    body.append(h('button', { class: 'btn', onclick: async () => {
      const p = await createPlaylist([effectId]);
      if (p) { toast(t('effects.addedTo', { effect: fxName(fx), playlist: p.name })); draw(); }
    } }, t('effects.newPlaylistWith')));
  };
  draw();
  await modal(t('effects.addToPlaylistTitle', { name: fxName(fx) || '' }), body, [{ label: t('common.close'), primary: true }]);
}
