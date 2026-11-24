'use strict';
// Mensagens entre o motor (src/engine) e o app. scripts/check.js confere que o motor só manda tipos daqui e que a
// janela só pede comandos daqui — um tipo novo entra nesta lista antes de ser usado.

/** Estado: a última mensagem de cada tipo vale; o principal guarda para entregar a uma janela que recarregue. */
const STATE_MESSAGES = ['devices', 'catalog', 'ram', 'gpus'];

/** Eventos: só repassados à janela. */
const EVENT_MESSAGES = ['device', 'log', 'logs', 'error', 'hardwareSaveResult', 'deviceParams', 'stopped'];

/** Comandos que a janela pode mandar ao motor (engine:cmd). init/config/settings/frame/shutdown/resume são só do principal. */
const UI_COMMANDS = ['setEnabled', 'setParam', 'pulse', 'reload', 'getLogs', 'clearLogs', 'rescan', 'ramRedetect', 'hardwareSave'];

/** Limite de LEDs por fita WLED (o app valida ao salvar; o motor recorta ao montar o dispositivo). */
const WLED_MAX_LEDS = 4096;

module.exports = { STATE_MESSAGES, EVENT_MESSAGES, UI_COMMANDS, WLED_MAX_LEDS };
