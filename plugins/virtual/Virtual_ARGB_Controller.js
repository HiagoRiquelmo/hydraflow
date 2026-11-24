// Controladora ARGB virtual com 3 canais e um subdispositivo, para testar componentes.
export function Name() { return "Controladora ARGB Virtual"; }
export function Type() { return "virtual"; }
export function Publisher() { return "Hydraflow"; }
export function DeviceType() { return "lightingcontroller"; }
export function Size() { return [6, 1]; }
export function DefaultPosition() { return [20, 20]; }
export function DefaultScale() { return 10; }
export function ControllableParameters() {
	return [
		{ property: "RGBconfig", group: "lighting", label: "Ordem de cor ARGB", type: "combobox", values: ["RGB", "GRB", "BGR"], default: "GRB" },
		{ property: "logo", group: "", label: "Criar subdispositivo Logo", type: "boolean", default: "1" }
	];
}
export function LedNames() { return ["Led 1", "Led 2", "Led 3", "Led 4", "Led 5", "Led 6"]; }
export function LedPositions() { return [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0]]; }

function makeLogo() {
	device.createSubdevice("Logo");
	device.setSubdeviceName("Logo", "Controladora ARGB Virtual - Logo");
	device.setSubdeviceSize("Logo", 3, 3);
	device.setSubdeviceLeds("Logo", ["Logo"], [[1, 1]]);
}

export function onlogoChanged() {
	if (logo) makeLogo(); else device.removeSubdevice("Logo");
}

export function Initialize() {
	device.SetLedLimit(360);
	for (let i = 1; i <= 3; i++) device.addChannel(`Canal ${i}`, 120);
	if (logo) makeLogo();
}

let tick = 0;
export function Render() {
	for (let i = 1; i <= 3; i++) {
		const colors = device.channel(`Canal ${i}`).getColors("Inline", RGBconfig);
		if (++tick % 1800 === 0) device.log(`Canal ${i}: ${colors.length / 3} LEDs`);
	}
	if (logo) device.subdeviceColor("Logo", 1, 1);
}
export function Shutdown() {}
export function ImageUrl() { return ""; }
