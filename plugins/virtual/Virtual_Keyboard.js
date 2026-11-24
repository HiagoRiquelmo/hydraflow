// Teclado virtual para testes (não acessa hardware).
export function Name() { return "Teclado Virtual"; }
export function Type() { return "virtual"; }
export function Publisher() { return "Hydraflow"; }
export function DeviceType() { return "keyboard"; }
export function Size() { return [22, 6]; }
export function DefaultPosition() { return [70, 120]; }
export function DefaultScale() { return 8; }
export function ControllableParameters() {
	return [
		{ property: "LightingMode", group: "lighting", label: "Modo de iluminação", type: "combobox", values: ["Canvas", "Forced"], default: "Canvas" },
		{ property: "forcedColor", group: "lighting", label: "Cor forçada", type: "color", default: "#00aaff" }
	];
}

const names = [];
const positions = [];
for (let y = 0; y < 6; y++) {
	for (let x = 0; x < 22; x++) {
		if (y === 0 && (x === 1 || x > 19)) continue;
		if (y === 5 && x > 3 && x < 10 && x !== 6) continue;
		names.push(`Tecla ${x},${y}`);
		positions.push([x, y]);
	}
}
export function LedNames() { return names; }
export function LedPositions() { return positions; }

let frames = 0;
export function Initialize() { device.log("Teclado virtual iniciado com " + positions.length + " LEDs"); }
export function Render() {
	for (const [x, y] of positions) {
		if (LightingMode === "Forced") continue;
		device.color(x, y);
	}
	if (++frames % 900 === 0) device.log(`${frames} quadros renderizados`);
}
export function Shutdown() { device.log("Teclado virtual desligado"); }
export function ImageUrl() { return ""; }
