'use strict';
// Descoberta de dispositivos HID e escolha do plugin/interface. Usada pelo motor e por scripts/detect.js.
const fs = require('fs');
const path = require('path');
const { PluginInstance, nullIo } = require('./pluginHost');
const { safeId } = require('./devices');

const hex4 = n => Number(n).toString(16).padStart(4, '0');

function walkPlugins(dir, out = [], depth = 0) {
  if (depth > 4) return out;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkPlugins(p, out, depth + 1);
    else if (/\.js$/i.test(e.name) && !/(_Protocol|\.test)\.js$/i.test(e.name)) out.push(p);
  }
  return out;
}

/** Interfaces HID no formato que os plugins recebem. */
function enumerateHid(HID) {
  return HID.devices().map(d => ({
    path: d.path, vendor_id: d.vendorId, product_id: d.productId, interface: d.interface,
    usage: d.usage, usage_page: d.usagePage, collection: 0, serial_number: d.serialNumber || '',
    product: d.product || '', manufacturer: d.manufacturer || ''
  }));
}

/** Agrupa interfaces por dispositivo físico (VID:PID:serial). */
function groupEndpoints(endpoints) {
  const groups = new Map();
  for (const ep of endpoints) {
    const g = `${hex4(ep.vendor_id)}:${hex4(ep.product_id)}:${safeId(ep.serial_number || 'x')}`;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(ep);
  }
  return groups;
}

function candidatesFor(catalog, eps) {
  const vid = eps[0].vendor_id, pid = eps[0].product_id;
  return catalog.filter(m => m.type === 'hid' && Number(m.vendorId) === vid && m.productIds.map(Number).includes(pid));
}

/** Interface que o plugin aceita (export Validate) ou a primeira; null se nenhuma servir. */
function chooseEndpoint(meta, eps, systemInfo) {
  const probe = new PluginInstance({ file: meta.file, io: nullIo(), systemInfo });
  if (!probe.has('Validate')) return eps[0];
  return eps.find(ep => { try { return !!probe.call('Validate', ep); } catch { return false; } }) || null;
}

module.exports = { hex4, walkPlugins, enumerateHid, groupEndpoints, candidatesFor, chooseEndpoint };
