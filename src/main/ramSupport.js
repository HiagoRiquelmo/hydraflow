'use strict';
// Suporte nativo a RGB de memória: driver PawnIO (oficial, assinado) + módulo SMBus oficial + auxiliar elevado do Hydraflow.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readZip } = require('./unzip');
const { LEGACY_TASK, taskName, helperPaths, helperArgs, probeHelper } = require('../smbus/protocol');
const { regValue, scheduledTask, powershell, psQuote, elevate, schtasks } = require('../common/winsys');

const PAWNIO_SETUP_API = 'https://api.github.com/repos/namazso/PawnIO.Setup/releases/latest';
const PAWNIO_MODULES_API = 'https://api.github.com/repos/namazso/PawnIO.Modules/releases/latest';
const MODULE_FILES = ['SmbusPIIX4.bin', 'SmbusI801.bin'];

class RamSupport {
  /** onStatus recebe só os campos que mudaram. t: tradutor do principal (mensagens de andamento e de erro). */
  constructor({ app, net, dataDir, onStatus, t = k => k }) {
    this.t = t;
    this.app = app;
    this.net = net;
    this.dataDir = dataDir;
    Object.assign(this, helperPaths(dataDir));
    this.onStatus = onStatus || (() => {});
    this.busy = null;
  }

  async driverVersion() {
    return regValue('HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\PawnIO', 'DisplayVersion');
  }
  modulesReady() { return MODULE_FILES.some(f => fs.existsSync(path.join(this.modulesDir, f))); }

  /**
   * Nome da tarefa agendada que serve para ESTE executável e esta pasta de dados, ou null. Cada executável tem a sua
   * (taskName); a de nome antigo ainda vale se apontar para este. Uma tarefa de outra instalação (app movido,
   * reinstalado ou versão de desenvolvimento) "roda" sem fazer nada.
   */
  // A resposta só muda quando a tarefa é registrada (ativação): guardada até lá (antes: um PowerShell de ~700 ms a cada
  // abertura da tela Dispositivos).
  async validTask() {
    if (this.taskCache !== undefined) return this.taskCache;
    const same = (x, y) => path.resolve(String(x || '')).toLowerCase() === path.resolve(y).toLowerCase();
    for (const name of [taskName(process.execPath), LEGACY_TASK]) {
      const tk = await scheduledTask(name);
      if (tk && same(tk.command, process.execPath) && tk.arguments.toLowerCase().includes(`--data-dir=${this.dataDir}`.toLowerCase())) return (this.taskCache = name);
    }
    return (this.taskCache = null);
  }

  /** O auxiliar responde de verdade (conexão autenticada)? Arquivo de conexão de um auxiliar morto é apagado. */
  async helperAlive() {
    if (!fs.existsSync(this.connFile)) return false;
    if (await probeHelper(this.connFile)) return true;
    try { fs.rmSync(this.connFile, { force: true }); } catch {} // sobrou de um auxiliar que morreu sem limpar
    return false;
  }

  /** Espera o auxiliar responder (ou desiste). */
  async waitHelper(ms) {
    for (const end = Date.now() + ms; Date.now() < end;) {
      if (fs.existsSync(this.connFile) && await probeHelper(this.connFile)) return true;
      await new Promise(r => setTimeout(r, 500));
    }
    return false;
  }

  async status() {
    const [driver, task, helper] = await Promise.all([this.driverVersion(), this.validTask(), this.helperAlive()]);
    return { driver, modules: this.modulesReady(), task: !!task, helper, busy: this.busy };
  }

  async fetchOk(url, opts) {
    const r = await this.net.fetch(url, { ...opts, headers: { 'User-Agent': 'Hydraflow', ...opts?.headers } });
    if (!r.ok) throw new Error(this.t('ram.http', { status: r.status, url }));
    return r;
  }

  async download(url, file) {
    const r = await this.fetchOk(url);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    return file;
  }

  async assetUrl(api, match) {
    const rel = await (await this.fetchOk(api, { headers: { Accept: 'application/vnd.github+json' } })).json();
    const asset = (rel.assets || []).find(a => match.test(a.name));
    if (!asset) throw new Error(this.t('ram.assetMissing', { version: rel.tag_name }));
    return { url: asset.browser_download_url, tag: rel.tag_name };
  }

  /** Baixa os módulos SMBus oficiais (assinados, LGPL-2.1) do repositório PawnIO.Modules. */
  async ensureModules() {
    if (this.modulesReady()) return;
    // módulos que vêm dentro do app (instalador): sem download
    const bundled = path.join(process.resourcesPath || '', 'pawnio', 'modules');
    if (MODULE_FILES.some(f => fs.existsSync(path.join(bundled, f)))) {
      fs.mkdirSync(this.modulesDir, { recursive: true });
      for (const f of fs.readdirSync(bundled)) fs.copyFileSync(path.join(bundled, f), path.join(this.modulesDir, f));
      if (this.modulesReady()) return;
    }
    this.setBusy(this.t('ram.downloadingModule'));
    const { url, tag } = await this.assetUrl(PAWNIO_MODULES_API, /\.zip$/i);
    const zip = await this.download(url, path.join(os.tmpdir(), `pawnio-modules-${tag}.zip`));
    let n = 0;
    let entries;
    try { entries = readZip(fs.readFileSync(zip)); } catch (e) { throw new Error(this.t('ram.zipBad', { error: e.message })); }
    for (const e of entries) {
      const base = path.basename(e.name);
      if (MODULE_FILES.includes(base)) { fs.mkdirSync(this.modulesDir, { recursive: true }); fs.writeFileSync(path.join(this.modulesDir, base), e.read()); n++; }
    }
    if (!n) throw new Error(this.t('ram.modulesMissing'));
    fs.writeFileSync(path.join(this.modulesDir, 'VERSION.txt'), `PawnIO.Modules ${tag} (LGPL-2.1) — https://github.com/namazso/PawnIO.Modules\n`);
  }

  /** Instalador oficial que vem dentro do app (resources/pawnio), ou null em desenvolvimento/instalação antiga. */
  bundledSetup() {
    const f = path.join(process.resourcesPath || '', 'pawnio', 'PawnIO_setup.exe');
    return fs.existsSync(f) ? f : null;
  }

  /** Sem instalador embutido: baixa e executa o oficial do PawnIO (interativo; pede permissão de administrador). */
  async installDriver() {
    this.setBusy(this.t('ram.downloadingDriver'));
    const { url, tag } = await this.assetUrl(PAWNIO_SETUP_API, /PawnIO_setup\.exe$/i);
    const exe = await this.download(url, path.join(os.tmpdir(), `PawnIO_setup-${tag}.exe`));
    this.setBusy(this.t('ram.installingDriver'));
    const r = await powershell(`$p = Start-Process -FilePath ${psQuote(exe)} -Verb RunAs -Wait -PassThru; $p.ExitCode`, { timeout: 10 * 60000 });
    if (!r.ok) throw new Error(/cancel/i.test(r.err) ? this.t('ram.installCancelled') : r.err || this.t('ram.installerFailed'));
    return this.driverVersion();
  }

  /** Pela tarefa agendada (sem pedir permissão), com schtasks /Run. true se o auxiliar respondeu. */
  async startViaTask() {
    const task = await this.validTask();
    if (!task) return false;
    if (!(await schtasks(['/Run', '/TN', task])).ok) return false; // tarefa que o usuário não consegue iniciar: refaz
    return this.waitHelper(15000);
  }

  /**
   * Abre o auxiliar com permissão de administrador (o Windows pede confirmação UMA vez): ele instala o driver
   * (installDriver = instalador embutido, se faltar) e registra a tarefa para as próximas vezes, sem janela de terminal.
   */
  elevateHelper(installDriver = null) {
    const appArgs = this.app.isPackaged ? [] : [this.app.getAppPath()];
    const r = elevate(process.execPath, helperArgs(appArgs, this.dataDir, true, installDriver));
    this.taskCache = undefined; // a tarefa é (re)registrada agora: a próxima consulta lê de novo
    if (!r.ok) throw new Error(r.error === 'cancelled' ? this.t('ram.uacDenied') : r.error);
  }

  /** Inicia o auxiliar e só termina quando ele está de pé (pela tarefa; sem ela, elevado). */
  async startHelper(installDriver = null) {
    if (await this.helperAlive()) return;
    this.setBusy(this.t('ram.startingHelper'));
    if (!installDriver && await this.startViaTask()) return;
    this.setBusy(this.t('ram.confirmUac'));
    this.elevateHelper(installDriver);
    this.setBusy(this.t('ram.startingHelper'));
    if (!await this.waitHelper(installDriver ? 120000 : 30000)) {
      const e = new Error(this.t('ram.helperNoAnswer'));
      e.restart = true;
      throw e;
    }
  }

  /**
   * Na abertura do app (e ao voltar da suspensão): só pela tarefa já autorizada, nunca pedindo permissão de surpresa.
   * true se o auxiliar está respondendo. Enquanto tenta, o painel mostra "Conectando" em vez do botão Ativar.
   */
  resumeHelper() {
    if (this.running) return this.running;
    this.running = (async () => {
      try {
        if (await this.helperAlive()) return true;
        if (!this.modulesReady() || !await this.driverVersion()) return false;
        this.setBusy(this.t('devices.ramConnecting'));
        return await this.startViaTask();
      } catch { return false; } finally { this.setBusy(null); this.running = null; }
    })();
    return this.running;
  }

  /** Fluxo completo de ativação com um clique (uma permissão do Windows). Dois cliques = uma ativação. */
  enable() {
    if (this.enabling) return this.enabling;
    this.enabling = (async () => {
      try {
        await this.running; // a abertura do app pode estar subindo o auxiliar agora
        let driver = await this.driverVersion();
        const setup = driver ? null : this.bundledSetup();
        if (!driver && !setup) driver = await this.installDriver(); // instalação antiga, sem o driver embutido
        if (!driver && !setup) throw new Error(this.t('ram.noDriver'));
        await this.ensureModules();
        await this.startHelper(setup);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message, restart: !!e.restart };
      } finally {
        this.taskCache = undefined;
        this.setBusy(null);
        this.enabling = null;
      }
    })();
    return this.enabling;
  }

  /**
   * Pré-ativação feita pelo INSTALADOR (Hydraflow.exe --setup-ram): driver e módulos oficiais que vêm dentro do app
   * e UMA permissão do Windows (sem janela de terminal). Não espera o auxiliar responder — o instalador termina na
   * hora e o app, ao abrir, conecta sozinho (bootRetries). Já ativado e funcionando: não pede nada. { ok, error? }
   */
  async preinstall(bundleDir) {
    try {
      const setup = path.join(bundleDir, 'PawnIO_setup.exe');
      fs.mkdirSync(this.modulesDir, { recursive: true });
      for (const f of [...MODULE_FILES, 'VERSION.txt']) {
        const src = path.join(bundleDir, 'modules', f), dst = path.join(this.modulesDir, f);
        if (fs.existsSync(src) && !fs.existsSync(dst)) fs.copyFileSync(src, dst);
      }
      if (!this.modulesReady()) return { ok: false, error: this.t('ram.modulesMissing') };
      const driver = await this.driverVersion();
      // reinstalação: a tarefa existe E o usuário consegue iniciá-la (uma tarefa no estado quebrado é refeita)
      if (driver && (await this.helperAlive() || await this.startViaTask())) return { ok: true };
      if (!driver && !fs.existsSync(setup)) return { ok: false, error: this.t('ram.noDriver') };
      this.elevateHelper(driver ? null : setup);
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  setBusy(msg) { this.busy = msg; this.onStatus({ busy: msg }); }
}

module.exports = { RamSupport };
