'use strict';
// Módulos internos disponíveis aos plugins via import.

function noopProxy(name, log) {
  const warned = new Set();
  const handler = {
    get(_, prop) {
      if (prop === 'default') return proxy;
      if (prop === Symbol.toPrimitive || prop === 'then') return undefined;
      return (...args) => {
        if (!warned.has(prop)) { warned.add(prop); log?.(`[aviso] ${name}.${String(prop)} não é suportado; ignorado.`); }
        return undefined;
      };
    }
  };
  const proxy = new Proxy({}, handler);
  return proxy;
}

function makeShims(ctx) {
  const { systemInfo, log } = ctx;

  class ContextError extends Error {}
  const Assert = new Proxy({}, {
    get(_, prop) {
      return (value, ...rest) => {
        const msg = rest.find(r => typeof r === 'string') || `Assert.${String(prop)} falhou`;
        const ok = prop === 'isOk' || prop === 'ok' ? !!value
          : prop === 'isNotNull' ? value != null
          : prop === 'isEqual' ? value === rest[0]
          : prop === 'isArray' ? Array.isArray(value)
          : true;
        if (!ok) throw new ContextError(msg);
        return value;
      };
    }
  });
  const errors = { Assert, ContextError, globalContext: {} };

  const systeminfo = {
    GetMotherboardInfo: () => ({ model: systemInfo.motherboard || 'Unknown', manufacturer: systemInfo.manufacturer || 'Unknown', bios: systemInfo.bios || '' }),
    GetCpuInfo: () => ({ name: systemInfo.cpu || 'Unknown' }),
    GetGpuInfo: () => ([]),
    GetRamInfo: () => ([])
  };

  const permissions = new Proxy({}, {
    get(_, prop) {
      if (prop === 'permissions') return {};
      return () => true;
    }
  });

  return {
    systeminfo: { default: systeminfo, ...systeminfo },
    errors: { default: errors, ...errors },
    permissions: { default: permissions },
    lcd: { default: noopProxy('LCD', log) },
    devicediscovery: { default: noopProxy('DeviceDiscovery', log) },
    serial: { default: noopProxy('serial', log) }
  };
}

function shimNameFor(spec) {
  const m = spec.match(/^@(?:SignalRGB|rgb|RGBStudio|Hydraflow)\/(.+?)(?:\.js)?$/i);
  return m ? m[1].toLowerCase() : null;
}

module.exports = { makeShims, shimNameFor, noopProxy };
