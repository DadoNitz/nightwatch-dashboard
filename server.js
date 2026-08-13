const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const si = require('systeminformation');

const PORT = Number(process.env.PORT || 4280);
const HOST = '127.0.0.1';
const PUBLIC = path.join(__dirname, 'public');
const APP_VERSION = '2026.08.13.1';

let lastNet = null;
let lastAt = Date.now();
const history = [];
let cache = null;
let collecting = null;
let connectionCache = { at: 0, totals: { established: 0, listening: 0, external: 0 }, rows: [] };
let connectionCollecting = null;
let newsCache = { at: 0, items: [], source: 'Google Notícias' };
let newsCollecting = null;
let hardwareCache = { ok: false, at: 0, cpuTemp: null, fans: [], temperatures: [], error: 'Aguardando sensores' };
let hardwareCollecting = null;
let processCache = { at: 0, list: [] };
let processCollecting = null;
let networkHealthCache = { at: 0, target: '1.1.1.1', latency: null, packetLoss: null, interface: null, interfaceName: null, available: [], error: 'Aguardando teste' };
let networkHealthCollecting = null;
const sensorBridge = path.join(__dirname, 'sensor-bridge', 'bin', 'Release', 'net8.0-windows', 'Nightwatch.SensorBridge.dll');
const fanControlExe = 'C:\\Program Files (x86)\\FanControl\\FanControl.exe';
const fanControlConfig = 'C:\\Program Files (x86)\\FanControl\\Configurations\\userConfig.json';
const settingsFile = path.join(__dirname, 'nightwatch.settings.json');
const defaultSettings = {
  profile: 'normal',
  interface: 'auto',
  thresholds: { cpuTemp: 85, gpuTemp: 82, diskUsage: 90, latency: 140 },
  ticker: true,
  theme: 'nightwatch'
};
let settings = { ...defaultSettings, thresholds: { ...defaultSettings.thresholds } };
try {
  const saved = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  settings = { ...settings, ...saved, thresholds: { ...settings.thresholds, ...(saved.thresholds || {}) } };
} catch {}

function nvidia() {
  return new Promise((resolve) => {
    const args = ['--query-gpu=name,temperature.gpu,utilization.gpu,memory.used,memory.total,power.draw,fan.speed', '--format=csv,noheader,nounits'];
    execFile('nvidia-smi', args, { timeout: 1800, windowsHide: true }, (err, out) => {
      if (err || !out.trim()) return resolve(null);
      const p = out.trim().split(',').map(v => v.trim());
      resolve({ name:p[0], temp:+p[1], usage:+p[2], memoryUsed:+p[3], memoryTotal:+p[4], power:+p[5], fan:+p[6] || null });
    });
  });
}

// `systeminformation.networkStats()` follows the adapter Windows marks as
// default. VPN software (notably Radmin VPN) can claim that route while the
// actual internet traffic still uses Ethernet. `netstat -e` reads the TCP/IP
// stack totals directly, so physical, Wi-Fi and VPN traffic are all covered.
function networkCounters() {
  return new Promise((resolve) => {
    execFile('netstat', ['-e'], { timeout: 1800, windowsHide: true }, (err, out) => {
      if (err || !out) return resolve(lastNet || { rx: 0, tx: 0 });
      const match = out.match(/^\s*Bytes\s+(\d+)\s+(\d+)/mi);
      resolve(match ? { rx: Number(match[1]), tx: Number(match[2]) } : (lastNet || { rx: 0, tx: 0 }));
    });
  });
}

function splitEndpoint(value) {
  const clean = value.replace(/^\[|\]$/g, '');
  const cut = clean.lastIndexOf(':');
  return cut < 0 ? { host: clean, port: '' } : {
    host: clean.slice(0, cut).replace(/^\[|\]$/g, ''),
    port: clean.slice(cut + 1)
  };
}

function isExternal(host) {
  return !(
    host === '0.0.0.0' || host === '::' || host === '::1' ||
    host.startsWith('127.') || host.startsWith('10.') ||
    host.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^f[cd]/i.test(host) || /^fe80:/i.test(host)
  );
}

async function connectionSnapshot() {
  const output = await new Promise((resolve, reject) => {
    execFile('netstat', ['-ano', '-p', 'tcp'], { timeout: 2500, windowsHide: true }, (err, out) => err ? reject(err) : resolve(out));
  });
  const processes = await si.processes();
  const processNames = new Map(processes.list.map(p => [Number(p.pid), p.name || 'SYSTEM']));
  const all = output.split(/\r?\n/).map(line => line.trim().split(/\s+/)).filter(p => p.length === 5 && p[0] === 'TCP').map(p => {
    const local = splitEndpoint(p[1]);
    const remote = splitEndpoint(p[2]);
    const pid = Number(p[4]);
    return { protocol: p[0], local, remote, state: p[3], pid, process: processNames.get(pid) || `PID ${pid}`, external: isExternal(remote.host) };
  });
  const established = all.filter(c => c.state === 'ESTABLISHED');
  const rows = established.sort((a, b) => Number(b.external) - Number(a.external) || a.process.localeCompare(b.process)).slice(0, 30);
  return {
    at: Date.now(),
    totals: {
      established: established.length,
      listening: all.filter(c => c.state === 'LISTENING').length,
      external: established.filter(c => c.external).length,
      processes: new Set(established.map(c => c.pid)).size
    },
    rows
  };
}

async function refreshConnections() {
  if (connectionCollecting) return connectionCollecting;
  connectionCollecting = connectionSnapshot()
    .then(data => (connectionCache = data))
    .catch(err => { console.error('Falha no Network Intel:', err.message); return connectionCache; })
    .finally(() => { connectionCollecting = null; });
  return connectionCollecting;
}

async function processSnapshot() {
  const data = await si.processes();
  const list = (data.list || [])
    .filter(p => Number(p.pid) > 0)
    .sort((a, b) => Number(b.cpu || 0) - Number(a.cpu || 0) || Number(b.mem || 0) - Number(a.mem || 0))
    .slice(0, 12)
    .map(p => ({ pid: Number(p.pid), name: p.name || p.command || 'SYSTEM', cpu: Number(p.cpu || 0), memory: Number(p.mem || 0), command: p.command || '' }));
  return { at: Date.now(), list };
}

async function refreshProcesses() {
  if (processCollecting) return processCollecting;
  processCollecting = processSnapshot()
    .then(data => (processCache = data))
    .catch(err => { console.error('Falha no top de processos:', err.message); return processCache; })
    .finally(() => { processCollecting = null; });
  return processCollecting;
}

function pingSnapshot() {
  return new Promise((resolve) => {
    execFile('ping', ['-n', '1', '-w', '1200', '1.1.1.1'], { timeout: 2200, windowsHide: true }, async (err, out) => {
      const text = String(out || '');
      const match = text.match(/(?:time|tempo)[=<]\s*(\d+)\s*ms/i);
      let selected = null;
      try {
        const interfaces = await si.networkInterfaces();
        const ignored = /radmin|hamachi|zerotier|tailscale|loopback|teredo|virtual|vpn|tunnel/i;
        const candidates = interfaces
          .filter(i => i.operstate === 'up' && !i.internal && !i.virtual && !ignored.test(`${i.iface} ${i.ifaceName}`) && (i.ip4 || i.ip6))
          .sort((a, b) => Number(Boolean(b.dhcp)) - Number(Boolean(a.dhcp)) || Number(b.speed || 0) - Number(a.speed || 0));
        selected = candidates.find(i => settings.interface !== 'auto' && i.iface === settings.interface) || candidates[0] || null;
        const available = candidates.map(i => ({ iface: i.iface, name: i.ifaceName || i.iface, speed: i.speed || null }));
        resolve({ at: Date.now(), target: '1.1.1.1', latency: match ? Number(match[1]) : null, packetLoss: /Lost\s*=\s*0|Perdidos\s*=\s*0/i.test(text) ? 0 : 100, interface: selected?.iface || null, interfaceName: selected?.ifaceName || null, available, error: err && !match ? 'Destino indisponível' : null });
        return;
      } catch {}
      resolve({ at: Date.now(), target: '1.1.1.1', latency: match ? Number(match[1]) : null, packetLoss: /Lost\s*=\s*0|Perdidos\s*=\s*0/i.test(text) ? 0 : 100, interface: selected?.iface || null, interfaceName: selected?.ifaceName || null, available: [], error: err && !match ? 'Destino indisponível' : null });
    });
  });
}

async function refreshNetworkHealth() {
  if (networkHealthCollecting) return networkHealthCollecting;
  networkHealthCollecting = pingSnapshot()
    .then(data => (networkHealthCache = data))
    .catch(err => { networkHealthCache.error = err.message; return networkHealthCache; })
    .finally(() => { networkHealthCollecting = null; });
  return networkHealthCollecting;
}

function computeAlerts(data) {
  const out = [];
  const t = settings.thresholds;
  if (data?.cpu?.temp != null && data.cpu.temp >= Number(t.cpuTemp)) out.push({ level: 'critical', code: 'CPU_TEMP', message: `CPU em ${Math.round(data.cpu.temp)}°C` });
  if (data?.gpu?.temp != null && data.gpu.temp >= Number(t.gpuTemp)) out.push({ level: 'critical', code: 'GPU_TEMP', message: `GPU em ${Math.round(data.gpu.temp)}°C` });
  for (const disk of data?.disks || []) if (Number(disk.usage) >= Number(t.diskUsage)) out.push({ level: 'warn', code: 'DISK_FULL', message: `${disk.mount || disk.name} em ${Math.round(disk.usage)}%` });
  if (networkHealthCache.latency != null && networkHealthCache.latency >= Number(t.latency)) out.push({ level: 'warn', code: 'LATENCY', message: `Latência ${networkHealthCache.latency} ms` });
  for (const fan of hardwareCache.fans || []) if (fan.enabled && fan.rpm != null && fan.rpm < 150 && !fan.isPump) out.push({ level: 'critical', code: 'FAN_STOP', message: `${fan.name} abaixo de 150 RPM` });
  return out;
}

function decodeXml(value = '') {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos);/gi, (_, code) => {
    if (code[0] === '#') return String.fromCodePoint(parseInt(code.slice(code[1].toLowerCase() === 'x' ? 2 : 1), code[1].toLowerCase() === 'x' ? 16 : 10));
    return entities[code.toLowerCase()] || _;
  });
}

function tag(xml, name) {
  const match = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return match ? decodeXml(match[1].trim()) : '';
}

async function newsSnapshot() {
  const query = '(site:tecmundo.com.br OR site:tecnoblog.net OR site:canaltech.com.br OR site:olhardigital.com.br) when:3d';
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
  const response = await fetch(url, { headers: { 'User-Agent': 'Nightwatch-Dashboard/1.0' }, signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`feed HTTP ${response.status}`);
  const xml = await response.text();
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, 18).map(match => {
    const block = match[1];
    const source = tag(block, 'source');
    let title = tag(block, 'title');
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    return { title, source: source || 'Tecnologia', link: tag(block, 'link'), published: tag(block, 'pubDate') };
  }).filter(item => item.title);
  if (!items.length) throw new Error('feed sem notícias');
  return { at: Date.now(), source: 'Google Notícias', items };
}

async function refreshNews() {
  if (newsCollecting) return newsCollecting;
  newsCollecting = newsSnapshot()
    .then(data => (newsCache = data))
    .catch(err => { console.error('Falha nas notícias:', err.message); return newsCache; })
    .finally(() => { newsCollecting = null; });
  return newsCollecting;
}

function configuredFans() {
  try {
    const config = JSON.parse(fs.readFileSync(fanControlConfig, 'utf8'));
    return (config.FanControl?.Controls || []).filter(c => !c.IsHidden).map(c => ({
      id: c.Identifier,
      fanId: c.PairedFanSensor?.Identifier || null,
      name: c.NickName || c.Identifier,
      enabled: Boolean(c.Enable),
      mode: c.ManualControl ? 'Manual' : (c.SelectedFanCurve?.Name || 'Automático'),
      configuredPercent: c.ManualControl ? c.ManualControlValue : null,
      curve: c.SelectedFanCurve?.Name || null,
      isPump: /bomba|pump/i.test(c.NickName || '')
    }));
  } catch { return []; }
}

function hardwareSnapshot() {
  return new Promise((resolve) => {
    if (!fs.existsSync(sensorBridge)) return resolve({ ...hardwareCache, error: 'Ponte de sensores não compilada' });
    execFile('dotnet', ['exec', '--fx-version', '10.0.10', sensorBridge], { timeout: 6000, windowsHide: true }, (err, out) => {
      let raw;
      try { raw = JSON.parse((out || '').trim()); } catch { raw = { ok: false, error: err?.message || 'Resposta inválida dos sensores', sensors: [] }; }
      const sensors = raw.sensors || [];
      const temperatures = sensors.filter(s => s.type === 'Temperature');
      const cpuTemperatures = temperatures.filter(s => /cpu|processor|ryzen|core|package|tctl|tdie/i.test(`${s.hardware} ${s.name} ${s.id}`));
      const priority = s => /package|tctl|tdie/i.test(s.name) ? 3 : /core average|cpu/i.test(s.name) ? 2 : 1;
      const cpuSensor = cpuTemperatures.sort((a, b) => priority(b) - priority(a))[0] || null;
      const sensorById = new Map(sensors.map(s => [s.id, s]));
      const configured = configuredFans();
      const usedFanIds = new Set(configured.map(f => f.fanId).filter(Boolean));
      const fans = configured.map(f => ({ ...f, rpm: sensorById.get(f.fanId)?.value ?? null, percent: sensorById.get(f.id)?.value ?? f.configuredPercent }));
      for (const sensor of sensors.filter(s => s.type === 'Rpm' && !usedFanIds.has(s.id))) {
        fans.push({ id: sensor.id, fanId: sensor.id, name: sensor.name, enabled: true, mode: 'Monitor', configuredPercent: null, curve: null, isPump: /pump|bomba/i.test(sensor.name), rpm: sensor.value, percent: null });
      }
      resolve({ ok: Boolean(raw.ok), at: raw.at || Date.now(), cpuTemp: cpuSensor?.value ?? null, cpuSensor: cpuSensor?.name || null, fans, temperatures: temperatures.slice(0, 12), error: raw.ok ? null : (raw.error || err?.message || 'Sensores indisponíveis') });
    });
  });
}

async function refreshHardware() {
  if (hardwareCollecting) return hardwareCollecting;
  hardwareCollecting = hardwareSnapshot()
    .then(data => (hardwareCache = data))
    .catch(err => { hardwareCache.error = err.message; return hardwareCache; })
    .finally(() => { hardwareCollecting = null; });
  return hardwareCollecting;
}

async function snapshot() {
  const [load, mem, fsSize, net, temp, time, gpu] = await Promise.all([
    si.currentLoad(), si.mem(), si.fsSize(), networkCounters(), si.cpuTemperature(), si.time(), nvidia()
  ]);
  const now = Date.now();
  const dt = Math.max((now - lastAt) / 1000, .1);
  const speed = lastNet ? { down:Math.max(0,(net.rx-lastNet.rx)/dt), up:Math.max(0,(net.tx-lastNet.tx)/dt) } : {down:0,up:0};
  lastNet = net; lastAt = now;
  const data = {
    at: now,
    uptime: time.uptime,
    cpu: { usage: load.currentLoad, cores: load.cpus.map(c => c.load), temp: hardwareCache.cpuTemp ?? (temp.main > 0 ? temp.main : null) },
    memory: { used: mem.active, total: mem.total, usage: mem.total ? mem.active / mem.total * 100 : 0 },
    gpu,
    disks: fsSize.filter(d => d.size > 0 && !/^(A:|B:)/i.test(d.fs)).map(d => ({ name:d.fs || d.mount, mount:d.mount, used:d.used, size:d.size, usage:d.use })),
    network: { ...speed, totalDown: net.rx, totalUp: net.tx },
    hardware: hardwareCache
  };
  history.push({ t:now, cpu:data.cpu.usage, gpu:gpu?.usage || 0, down:speed.down, up:speed.up });
  if (history.length > 180) history.shift();
  data.networkHealth = networkHealthCache;
  data.processes = processCache;
  data.settings = settings;
  data.alerts = computeAlerts(data);
  data.history = history;
  return data;
}

async function refresh() {
  if (collecting) return collecting;
  collecting = snapshot()
    .then(data => (cache = data))
    .catch(err => { console.error('Falha na telemetria:', err.message); return cache; })
    .finally(() => { collecting = null; });
  return collecting;
}

function sendFile(req, res) {
  const rel = req.url === '/' ? 'index.html' : req.url.split('?')[0].replace(/^\/+/, '');
  const file = path.resolve(PUBLIC, rel);
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file)) { res.writeHead(404); return res.end('Not found'); }
  const ext = path.extname(file);
  const types = {'.html':'text/html; charset=utf-8','.css':'text/css','.js':'application/javascript'};
  res.writeHead(200, {'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control':'no-store'});
  fs.createReadStream(file).pipe(res);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 100000) req.destroy(); });
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.url.startsWith('/api/version')) {
    res.writeHead(200, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify({ version: APP_VERSION }));
    return;
  }
  if (req.url.startsWith('/api/hardware')) {
    try { const data = hardwareCache.at ? hardwareCache : await refreshHardware(); res.writeHead(200, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(data)); }
    catch (e) { res.writeHead(500, {'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify({error:e.message})); }
    return;
  }
  if (req.url.startsWith('/api/fans/open') && req.method === 'POST') {
    try { execFile(fanControlExe, [], { windowsHide: true }, () => {}); res.writeHead(200, {'Content-Type':'application/json'}); res.end('{"ok":true}'); }
    catch (e) { res.writeHead(500, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:e.message})); }
    return;
  }
  if (req.url.startsWith('/api/news')) {
    try { const data = newsCache.items.length ? newsCache : await refreshNews(); res.writeHead(200, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(data)); }
    catch (e) { res.writeHead(500, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:e.message})); }
    return;
  }
  if (req.url.startsWith('/api/connections')) {
    try { const data = connectionCache.at ? connectionCache : await refreshConnections(); res.writeHead(200, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(data)); }
    catch (e) { res.writeHead(500, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:e.message})); }
    return;
  }
  if (req.url.startsWith('/api/processes')) {
    try { const data = processCache.at ? processCache : await refreshProcesses(); res.writeHead(200, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(data)); }
    catch (e) { res.writeHead(500, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:e.message})); }
    return;
  }
  if (req.url.startsWith('/api/network/health')) {
    try { const data = req.url.includes('refresh=1') ? await refreshNetworkHealth() : (networkHealthCache.at ? networkHealthCache : await refreshNetworkHealth()); res.writeHead(200, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(data)); }
    catch (e) { res.writeHead(500, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:e.message})); }
    return;
  }
  if (req.url.startsWith('/api/settings') && req.method === 'GET') {
    res.writeHead(200, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(settings));
    return;
  }
  if (req.url.startsWith('/api/settings') && req.method === 'POST') {
    try {
      const incoming = await readJson(req);
      settings = { ...settings, ...incoming, thresholds: { ...settings.thresholds, ...(incoming.thresholds || {}) } };
      fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
      res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify({ ok: true, settings }));
    } catch (e) { res.writeHead(400, {'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,error:e.message})); }
    return;
  }
  if (req.url.startsWith('/api/stats')) {
    try { const data = cache || await refresh(); res.writeHead(200, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(data)); }
    catch (e) { res.writeHead(500, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:e.message})); }
    return;
  }
  sendFile(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`PC Monitor em http://${HOST}:${PORT}`);
  refresh();
  refreshConnections();
  refreshNews();
  refreshHardware();
  refreshProcesses();
  refreshNetworkHealth();
  setInterval(refresh, 2000).unref();
  setInterval(refreshConnections, 5000).unref();
  setInterval(refreshNews, 15 * 60 * 1000).unref();
  setInterval(refreshHardware, 3000).unref();
  setInterval(refreshProcesses, 5000).unref();
  setInterval(refreshNetworkHealth, 10000).unref();
});
