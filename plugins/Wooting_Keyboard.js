// Hydraflow — plugin próprio: teclados Wooting (One, Two, Two HE, 60HE, 80HE, UwU).
// Protocolo baseado na documentação/SDK aberto da Wooting (wooting-rgb-sdk, MPL-2.0):
//   comando de recurso: [rid, 0xD0|0xD1, 0xDA, cmd, p3, p2, p1, p0]   (0xD1 e rid=1 na interface 0xFF55)
//   quadro de cores:    [rid, 0xD0|0xD1, 0xDA, 11, matriz 6x21 em RGB565 little-endian]
export function Name() { return "Teclado Wooting"; }
export function Publisher() { return "Hydraflow"; }
export function VendorId() { return 0x31E3; }
const BASES = [0x1100, 0x1200, 0x1210, 0x1220, 0x1230, 0x1300, 0x1310, 0x1320, 0x1340, 0x1400, 0x1500, 0x1510];
export function ProductId() { const out = []; for (const b of BASES) out.push(b, b | 1, b | 2); return out; }
export function DeviceType() { return "keyboard"; }
export function Size() { return [21, 6]; }
export function DefaultPosition() { return [40, 110]; }
export function DefaultScale() { return 10; }
export function ImageUrl() { return ""; }

export function Validate(endpoint) {
	return endpoint.usage_page === 0xFF55 || endpoint.usage_page === 0x1337;
}

export function ControllableParameters() {
	return [
		{ property: "LightingMode", group: "lighting", label: "Origem da cor", type: "combobox", values: ["Efeito", "Fixa"], default: "Efeito" },
		{ property: "fixedColor", group: "lighting", label: "Cor fixa", type: "color", default: "#ffffff" },
		{ property: "restoreOnExit", group: "lighting", label: "Ao fechar, voltar à iluminação do teclado", type: "boolean", default: "1" }
	];
}

const RAW_COLORS = 11;
const CMD_COLOR_INIT = 33;
const CMD_RESET_ALL = 32;
const ROWS = 6, MATRIX_COLS = 21;

const MODELS = {
	0x1100: { name: "Wooting One", cols: 17, rows: 6 },
	0x1200: { name: "Wooting Two", cols: 21, rows: 6 },
	0x1210: { name: "Wooting Two Lekker", cols: 21, rows: 6 },
	0x1220: { name: "Wooting Two HE", cols: 21, rows: 6 },
	0x1230: { name: "Wooting Two HE (ARM)", cols: 21, rows: 6, small: true },
	0x1300: { name: "Wooting 60HE", cols: 14, rows: 6 },
	0x1310: { name: "Wooting 60HE (ARM)", cols: 14, rows: 6, small: true },
	0x1320: { name: "Wooting 60HE+", cols: 14, rows: 6, small: true },
	0x1340: { name: "Wooting 60HE v2", cols: 14, rows: 6 },
	0x1400: { name: "Wooting 80HE", cols: 17, rows: 6 },
	0x1500: { name: "Wooting UwU", cols: 7, rows: 5, small: true },
	0x1510: { name: "Wooting UwU RGB", cols: 7, rows: 5, small: true }
};

let model = MODELS[0x1200];
let v3 = false;

function hex(c) {
	const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(c || "");
	return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0];
}

function feature(cmd, p0 = 0, p1 = 0, p2 = 0, p3 = 0) {
	device.send_report([v3 ? 1 : 0, v3 ? 0xD1 : 0xD0, 0xDA, cmd, p3, p2, p1, p0], 8);
	device.read([0], v3 ? 2047 : 257, 300); // resposta do teclado (descartada)
}

export function Initialize() {
	const ep = device.getHidInfo();
	const pid = device.productId() & 0xFFF0;
	model = MODELS[pid] || MODELS[0x1200];
	v3 = ep.usage_page === 0xFF55;
	device.setName(model.name);
	const names = [], pos = [];
	for (let r = 0; r < model.rows; r++) for (let c = 0; c < model.cols; c++) { names.push(`Tecla ${r + 1}-${c + 1}`); pos.push([c, r]); }
	device.setSize([model.cols, model.rows]);
	device.setControllableLeds(names, pos);
	device.log(`${model.name}: interface ${v3 ? "0xFF55 (relatório múltiplo)" : "0x1337"}, matriz ${model.cols}x${model.rows}`);
	feature(CMD_COLOR_INIT);
	device.setFrameRateTarget(30);
}

function encode(rgb) { return ((rgb[0] & 0xF8) << 8) | ((rgb[1] & 0xFC) << 3) | ((rgb[2] & 0xF8) >> 3); }

export function Render(override) {
	const size = v3 ? 2047 : 257;
	const pkt = new Array(size).fill(0);
	pkt[0] = v3 ? 5 : 0; pkt[1] = v3 ? 0xD1 : 0xD0; pkt[2] = 0xDA; pkt[3] = RAW_COLORS;
	const fixed = LightingMode === "Fixa" ? hex(fixedColor) : null;
	for (let r = 0; r < Math.min(ROWS, model.rows); r++) {
		for (let c = 0; c < model.cols; c++) {
			const v = encode(override || fixed || device.color(c, r));
			const o = 4 + (r * MATRIX_COLS + c) * 2;
			pkt[o] = v & 0xFF; pkt[o + 1] = v >> 8;
		}
	}
	if (v3 || !model.small) { device.write(pkt, size); return; }
	for (let i = 0; i < 4; i++) device.write([0].concat(pkt.slice(1 + i * 64, 65 + i * 64)), 65);
}

export function Shutdown(suspending) {
	if (restoreOnExit && !suspending) feature(CMD_RESET_ALL);
	else Render([0, 0, 0]);
}
