// Hydraflow — plugin próprio: controladora ASUS Aura USB de placas-mãe (LEDs da placa, conectores 12 V e ARGB).
// Protocolo HID (relatório 0xEC, 65 bytes):
//   0x82 firmware | 0xB0 tabela de configuração | 0x35 modo do canal (0xFF = direto) | 0x40 cores diretas (até 20 LEDs por pacote)
import systeminfo from "@rgb/systeminfo";

export function Name() { return "ASUS Aura (placa-mãe)"; }
export function Publisher() { return "Hydraflow"; }
export function VendorId() { return 0x0B05; }
export function ProductId() { return [0x1867, 0x1872, 0x18A3, 0x18A5, 0x18F3, 0x1939, 0x19AF, 0x1AA6]; }
export function DeviceType() { return "motherboard"; }
export function Size() { return [1, 1]; }
export function DefaultPosition() { return [10, 10]; }
export function DefaultScale() { return 12; }
export function ImageUrl() { return ""; }

export function Validate(endpoint) {
	return endpoint.usage_page === 0xFF72 || endpoint.interface === 2 || endpoint.interface === 0;
}

const ORDERS = ["RGB", "RBG", "GRB", "GBR", "BRG", "BGR"];
const SAVED_MODE = "Gravado no dispositivo"; // escolhido sozinho depois de "Salvar no dispositivo"
const SHUTDOWN_MODES = ["Parecido com o efeito", "Última cor do efeito", "Respirar", "Ciclo de cores", "Arco-íris", "Cor escolhida", "Apagar", SAVED_MODE];
export function ControllableParameters() {
	return [
		{ property: "LightingMode", group: "lighting", label: "Origem da cor", description: "Efeito: segue o efeito ativo. Fixa: usa a cor abaixo.", type: "combobox", values: ["Efeito", "Fixa"], default: "Efeito" },
		{ property: "fixedColor", group: "lighting", label: "Cor fixa", type: "color", default: "#ffffff" },
		{ property: "shutdownMode", group: "lighting", label: "Ao fechar o app", description: "O que a placa mostra depois que o Hydraflow fecha. Fica gravado na placa (vale também ao religar o PC).", type: "combobox", values: SHUTDOWN_MODES, default: SHUTDOWN_MODES[0] },
		{ property: "shutdownColor", group: "lighting", label: "Cor para \"Cor escolhida\"", type: "color", default: "#ffffff" },
		{ property: "savedPlan", group: "lighting", label: "Plano gravado", type: "textfield", default: "", hidden: true }, // escrito por SaveToDevice
		{ property: "boardOrder", group: "avançado", label: "Ordem de cor dos LEDs da placa", type: "combobox", values: ORDERS, default: "RGB" },
		{ property: "headerOrder", group: "avançado", label: "Ordem de cor dos conectores 12 V", type: "combobox", values: ORDERS, default: "RGB" },
		{ property: "argbOrder", group: "avançado", label: "Ordem de cor dos conectores ARGB", type: "combobox", values: ORDERS, default: "RGB" }
	];
}

const REPORT = 0xEC;
const LEN = 65;
const PER_PACKET = 20;
const CHANNEL_LIMIT = 120;
const BOARD_DIRECT_CHANNEL = 4;

// Placas cuja tabela de configuração não reflete o hardware real (contagens conhecidas).
const KNOWN_BOARDS = {
	"ROG STRIX B850-F GAMING WIFI": { board: 2, argb: 3, headers: 2 },
	"ROG STRIX B650-A GAMING WIFI": { board: 3, argb: 3, headers: 1 },
	"ROG STRIX B650E-F GAMING WIFI": { board: 3, argb: 3, headers: 1 },
	"ROG STRIX X670E-E GAMING WIFI": { board: 3, argb: 3, headers: 1 },
	"ROG STRIX Z790-E GAMING WIFI": { board: 3, argb: 3, headers: 1 },
	"TUF GAMING X570-PRO (WI-FI)": { board: 3, argb: 1, headers: 2 },
	"PRIME Z790-A WIFI": { board: 4, argb: 3, headers: 1 }
};

const info = { firmware: "", board: 0, argb: 0, headers: 0 };
const headerNames = [];

function hex(c) {
	const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(c || "");
	return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0];
}

function reorder(rgb, order) {
	const idx = { R: 0, G: 1, B: 2 };
	return [idx[order[0]], idx[order[1]], idx[order[2]]].map(i => rgb[i]);
}

function drain() {
	device.flush();
}

function query(cmd) {
	drain();
	device.write([REPORT, cmd], LEN);
	for (let tries = 0; tries < 4; tries++) {
		const r = device.read([REPORT], LEN, 300);
		if (device.getLastReadSize() > 0 && r[0] === REPORT) return r;
	}
	return null;
}

function readFirmware() {
	const r = query(0x82);
	if (!r || r[1] !== 0x02) return "";
	let s = "";
	for (let i = 2; i < 18 && r[i]; i++) s += String.fromCharCode(r[i]);
	return s.trim();
}

function readConfig() {
	const r = query(0xB0);
	if (!r || r[1] !== 0x30) return false;
	// tabela começa no byte 4 da resposta
	info.argb = r[4 + 0x02];
	const totalBoard = r[4 + 0x1B];
	info.headers = r[4 + 0x1D];
	info.board = Math.max(0, totalBoard - info.headers);
	return true;
}

function setDirect(channel) {
	device.write([REPORT, 0x35, channel, 0x00, 0x00, 0xFF], LEN);
}

// A controladora aceita ~1 pacote a cada 4,5 ms (medido): 184 LEDs = 10 pacotes ≈ 45 ms por quadro. Canal que não
// mudou desde o último envio não é reenviado (o modo direto mantém as cores); a cada 2 s vai tudo, por segurança.
const sentKey = new Map();
let fullAt = 0;
function stream(channel, rgbFlat, count) {
	count = Math.min(count, CHANNEL_LIMIT);
	let start = 0;
	if (count === 0) return;
	const key = count + ":" + Array.prototype.join.call(rgbFlat.slice ? rgbFlat.slice(0, count * 3) : rgbFlat, ",");
	if (sentKey.get(channel) === key && Date.now() - fullAt < 2000) return;
	sentKey.set(channel, key);
	while (start < count) {
		const n = Math.min(PER_PACKET, count - start);
		const last = start + n >= count;
		const pkt = [REPORT, 0x40, (last ? 0x80 : 0x00) | channel, start, n];
		for (let i = 0; i < n * 3; i++) pkt.push(rgbFlat[start * 3 + i] || 0);
		device.write(pkt, LEN);
		start += n;
	}
}

function buildGeometry() {
	const names = [], pos = [];
	for (let i = 0; i < info.board; i++) { names.push(`LED da placa ${i + 1}`); pos.push([i, 0]); }
	device.setSize([Math.max(1, info.board), 1]);
	device.setControllableLeds(names, pos);
	for (const n of headerNames) device.removeSubdevice(n);
	headerNames.length = 0;
	for (let i = 0; i < info.headers; i++) {
		const n = `12V ${i + 1}`;
		headerNames.push(n);
		device.createSubdevice(n);
		device.setSubdeviceName(n, `Conector 12 V ${i + 1}`);
		device.setSubdeviceSize(n, 3, 3);
		device.setSubdeviceLeds(n, ["12 V"], [[1, 1]]);
	}
	for (let i = 1; i <= info.argb; i++) device.addChannel(`ARGB ${i}`, CHANNEL_LIMIT);
}

export function Initialize() {
	sentKey.clear(); // (re)iniciado: a controladora pode ter voltado ao padrão — manda tudo de novo
	info.firmware = readFirmware();
	if (info.firmware) device.log(`Firmware: ${info.firmware}`);
	const ok = readConfig();
	if (!ok) device.log("Tabela de configuração não respondeu; usando valores padrão.", { level: "warning" });
	const board = String(systeminfo.GetMotherboardInfo().model || "").trim();
	const known = KNOWN_BOARDS[board.toUpperCase()] || KNOWN_BOARDS[board];
	if (known) { Object.assign(info, known); device.log(`Contagens conhecidas aplicadas para ${board}`); }
	if (!ok && !known) Object.assign(info, { board: 1, argb: 1, headers: 0 });
	if (board && board !== "Unknown") device.setName(`ASUS ${board}`);
	device.log(`LEDs da placa: ${info.board} · conectores 12 V: ${info.headers} · canais ARGB: ${info.argb}`);

	buildGeometry();
	device.write([REPORT, 0x52, 0x53, 0x00, 0x01], LEN); // usa o protocolo direto atual
	setDirect(0);
	for (let ch = 1; ch <= info.argb; ch++) setDirect(ch);
	device.setFrameRateTarget(30);
}

function colorFor(get) {
	if (LightingMode === "Fixa") return hex(fixedColor);
	return get();
}

// ---------- memória do que está tocando (para escolher o modo de hardware ao fechar) ----------
// last.board: cor de cada LED da placa/12 V; last.argb: cor média de cada conector ARGB (sem reordenar, em RGB)
const last = { board: [], argb: [] };
const HISTORY = 150; // ~5 s a 30 fps
const history = []; // por quadro: { avg:[r,g,b], lum, bins:Set de matizes (espacial) }

function hsv([r, g, b]) {
	const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
	let h = 0;
	if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
	return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max / 255 };
}

function remember(boardColors, argbColors) {
	last.board = boardColors;
	last.argb = argbColors;
	const all = boardColors.concat(argbColors);
	if (!all.length) return;
	const avg = [0, 1, 2].map(k => all.reduce((a, c) => a + c[k], 0) / all.length);
	const bins = new Set();
	for (const c of all) { const x = hsv(c); if (x.s > 0.35 && x.v > 0.15) bins.add(Math.floor(x.h / 30)); }
	history.push({ avg, lum: Math.max(...avg) / 255, bins });
	if (history.length > HISTORY) history.shift();
}

function avgOf(rgbFlat, count, order) {
	// desfaz a reordenação para guardar em RGB
	const inv = [order.indexOf("R"), order.indexOf("G"), order.indexOf("B")];
	const s = [0, 0, 0];
	const n = Math.max(1, Math.min(count, Math.floor(rgbFlat.length / 3)));
	for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) s[k] += rgbFlat[i * 3 + inv[k]] || 0;
	return s.map(v => Math.round(v / n));
}

export function Render(override) {
	if (Date.now() - fullAt >= 2000) { sentKey.clear(); fullAt = Date.now(); } // envio completo de tempos em tempos
	// placa + conectores 12 V vão juntos no canal direto da placa
	const data = [], boardColors = [], argbColors = [];
	for (let i = 0; i < info.board; i++) { const c = override || colorFor(() => device.color(i, 0)); boardColors.push(c); data.push(...reorder(c, boardOrder)); }
	for (const n of headerNames) { const c = override || colorFor(() => device.subdeviceColor(n, 1, 1)); boardColors.push(c); data.push(...reorder(c, headerOrder)); }
	stream(BOARD_DIRECT_CHANNEL, data, info.board + headerNames.length);

	let pulsing = false;
	for (let ch = 1; ch <= info.argb; ch++) {
		const c = device.channel(`ARGB ${ch}`);
		let count = c.LedCount();
		let rgb;
		if (override) rgb = device.createColorArray(override, count, "Inline", argbOrder);
		else if (c.shouldPulseColors()) { pulsing = true; count = 40; rgb = device.createColorArray(device.getChannelPulseColor(`ARGB ${ch}`), count, "Inline", argbOrder); }
		else if (LightingMode === "Fixa") rgb = device.createColorArray(fixedColor, count, "Inline", argbOrder);
		else rgb = c.getColors("Inline", argbOrder);
		stream(ch - 1, rgb, count);
		argbColors.push(count ? avgOf(rgb, count, argbOrder) : boardColors[0] || [0, 0, 0]);
	}
	if (!override && !pulsing) remember(boardColors, argbColors);
}

// ---------- modos próprios da controladora (continuam depois que o app fecha) ----------
// 0x35 canal de efeito + modo | 0x36 cores por LED (máscara de 16 bits) | 0x3F 0x55 grava na memória da placa
const HW = { off: 0, static: 1, breathing: 2, cycle: 4, rainbow: 5 };

function sendEffect(channel, mode) { device.write([REPORT, 0x35, channel, 0x00, 0x00, mode], LEN); }

function sendEffectColors(colors) {
	// LEDs da placa/12 V primeiro, depois 1 "LED" por conector ARGB (mesma ordem da tabela da controladora)
	const n = Math.min(colors.length, 16);
	if (!n) return;
	const mask = (1 << n) - 1;
	const pkt = [REPORT, 0x36, (mask >> 8) & 0xFF, mask & 0xFF, 0x00];
	for (let i = 0; i < n; i++) pkt.push(...colors[i]);
	device.write(pkt, LEN);
}

function commit() { device.write([REPORT, 0x3F, 0x55], LEN); }

// escolhe o modo de hardware que mais lembra o que estava tocando nos últimos segundos
function pickAutomatic() {
	if (!history.length) { device.log("Ao fechar: sem histórico de quadros"); return { mode: HW.static }; }
	const spatial = Math.max(...history.map(f => f.bins.size));
	const overTime = new Set();
	for (const f of history) for (const b of f.bins) overTime.add(b);
	{
		const l = history.map(f => f.lum);
		device.log(`Ao fechar: ${history.length} quadros · matizes ao mesmo tempo ${spatial} · matizes no tempo ${overTime.size} · brilho ${Math.min(...l).toFixed(2)}–${Math.max(...l).toFixed(2)}`);
	}
	if (spatial >= 4) return { mode: HW.rainbow };            // várias cores ao mesmo tempo
	if (overTime.size >= 4) return { mode: HW.cycle };         // cores trocando com o tempo
	const lums = history.map(f => f.lum);
	const hi = Math.max(...lums), lo = Math.min(...lums);
	if (hi > 0.1 && hi - lo > 0.35 * hi) {                      // pulsando
		const peak = history[lums.indexOf(hi)].avg;
		const k = 255 / Math.max(1, ...peak);
		return { mode: HW.breathing, color: peak.map(v => Math.round(v * k)) };
	}
	return { mode: HW.static };                                 // praticamente parado
}

const MODE_NAMES = { 0: "apagado", 1: "cor fixa", 2: "respirar", 4: "ciclo de cores", 5: "arco-íris" };

/** Cores por "LED" da tabela da controladora (placa/12 V e 1 por conector ARGB), já reordenadas, para um plano. */
function planColors(plan) {
	const total = info.board + headerNames.length;
	const fallback = plan.color || last.board[0] || [255, 255, 255];
	const colors = [];
	for (let i = 0; i < total; i++) colors.push(reorder(plan.color || last.board[i] || fallback, i < info.board ? boardOrder : headerOrder));
	for (let ch = 1; ch <= info.argb; ch++) colors.push(reorder(plan.color || last.argb[ch - 1] || fallback, argbOrder));
	return colors;
}

/** Escreve um modo próprio da controladora (modo + cores) e GRAVA na memória da placa (vale depois de desligar). */
function writeHardware(mode, colors, why) {
	device.log(`${why}: modo "${MODE_NAMES[mode]}" · cores ${JSON.stringify(colors)}`);
	const w = [];
	w.push(device.write([REPORT, 0x35, 0, 0x00, 0x00, mode], LEN));
	for (let ch = 1; ch <= info.argb; ch++) w.push(device.write([REPORT, 0x35, ch, 0x00, 0x00, mode], LEN));
	sendEffectColors(colors);
	commit();
	device.log(`${why}: comandos enviados (retornos de escrita: ${JSON.stringify(w)}) e gravados na controladora`);
}

function hardwareFallback() {
	const sel = typeof shutdownMode === "string" ? shutdownMode : SHUTDOWN_MODES[0];
	// "Gravado no dispositivo": regrava exatamente o que a pessoa salvou (o fechamento não substitui por outra coisa)
	if (sel === SAVED_MODE) {
		try { const s = JSON.parse(savedPlan || "{}"); if (Array.isArray(s.colors)) return writeHardware(s.mode, s.colors, "Ao fechar (gravado no dispositivo)"); }
		catch { device.log("Ao fechar: plano salvo ilegível; usando o automático", { level: "warning" }); }
	}
	let plan;
	switch (sel) {
		case "Última cor do efeito": plan = { mode: HW.static }; break;
		case "Respirar": plan = { ...pickAutomatic(), mode: HW.breathing }; break;
		case "Ciclo de cores": plan = { mode: HW.cycle }; break;
		case "Arco-íris": plan = { mode: HW.rainbow }; break;
		case "Cor escolhida": plan = { mode: HW.static, color: hex(shutdownColor) }; break;
		case "Apagar": plan = { mode: HW.off }; break;
		default: plan = pickAutomatic();
	}
	writeHardware(plan.mode, planColors(plan), `Ao fechar: opção "${sel}"`);
}

// ---------- "Salvar no dispositivo" (Hydraflow): grava agora, sem esperar o app fechar ----------
// static: as cores que estão nos LEDs agora (fixas) · auto: o modo da placa que mais lembra o efeito (como ao fechar)
export function HardwareSaveModes() { return ["static", "auto"]; }
export function SaveToDevice(plan) {
	const p = plan && plan.mode === "auto" ? pickAutomatic() : { mode: HW.static };
	const colors = planColors(p);
	writeHardware(p.mode, colors, "Salvar no dispositivo");
	// volta ao modo direto: o Hydraflow continua controlando ao vivo enquanto está aberto
	setDirect(0);
	for (let ch = 1; ch <= info.argb; ch++) setDirect(ch);
	sentKey.clear();
	return { ok: true, detail: MODE_NAMES[p.mode], params: { shutdownMode: SAVED_MODE, savedPlan: JSON.stringify({ mode: p.mode, colors }) } };
}

export function Shutdown(suspending) {
	// suspensão: só apaga (o app retoma o controle ao acordar); fechar o app: grava um modo próprio da placa
	device.log(`Shutdown chamado (${suspending ? "suspensão" : "fechando o app"})`);
	if (suspending) { Render(hex("#000000")); return; }
	try { hardwareFallback(); }
	catch (e) { device.log(`Falha ao gravar o modo da placa: ${e && e.stack || e}`, { level: "error" }); Render(hex(shutdownColor)); }
}
