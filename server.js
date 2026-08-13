const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const crypto = require('crypto');
const si = require('systeminformation');

const PORT = Number(process.env.PORT || 4280);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC = path.join(__dirname, 'public');
const APP_VERSION = '2026.08.14.2';

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
let diskHealthCache = { at: 0, disks: [], error: 'Aguardando leitura SMART' };
let diskHealthCollecting = null;
let diagnosticsCache = { at: 0, checks: [], ok: false };
let diagnosticsCollecting = null;
let networkAdvancedCache = { at: 0, groups: [], interfaces: [], capture: null };
let networkAdvancedCollecting = null;
let captureProcess = null;
let captureInfo = { active: false, file: null, startedAt: null, error: null };
const sensorBridge = path.join(__dirname, 'sensor-bridge', 'bin', 'Release', 'net8.0-windows', 'Nightwatch.SensorBridge.dll');
const fanControlExe = 'C:\\Program Files (x86)\\FanControl\\FanControl.exe';
const fanControlConfig = 'C:\\Program Files (x86)\\FanControl\\Configurations\\userConfig.json';
const settingsFile = path.join(__dirname, 'nightwatch.settings.json');
const defaultSettings = {
  profile: 'normal',
  interface: 'auto',
  historyHours: 24,
  alertsEnabled: true,
  thresholds: { cpuTemp: 85, gpuTemp: 82, diskUsage: 90, latency: 140 },
  ticker: true,
  theme: 'nightwatch'
};
let settings = { ...defaultSettings, thresholds: { ...defaultSettings.thresholds } };
try {
  const saved = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  settings = { ...settings, ...saved, thresholds: { ...settings.thresholds, ...(saved.thresholds || {}) } };
} catch {}

const historyFile = path.join(__dirname, 'nightwatch.history.json');
let longHistory = [];
try { longHistory = JSON.parse(fs.readFileSync(historyFile, 'utf8')); if (!Array.isArray(longHistory)) longHistory = []; } catch {}
let historyDirty = false;

const agentDataFile = path.join(__dirname, 'jarvis.agent.json');
let agentData = { token: crypto.randomBytes(24).toString('hex'), reminders: [], conversations: [], google: null };
try { agentData = { ...agentData, ...JSON.parse(fs.readFileSync(agentDataFile, 'utf8')) }; } catch {}
function saveAgentData() { try { fs.writeFileSync(agentDataFile, JSON.stringify(agentData, null, 2)); } catch (err) { console.error('Falha ao salvar dados do Jarvis:', err.message); } }
saveAgentData();

const googleScopes = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly'
];
const googleRedirect = process.env.GOOGLE_REDIRECT_URI || `http://127.0.0.1:${PORT}/auth/google/callback`;

function json(res, status, body) { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(body)); }
function agentAuthorized(req) {
  if (HOST === '127.0.0.1' && (req.socket.remoteAddress === '127.0.0.1' || req.socket.remoteAddress === '::1')) return true;
  const auth = String(req.headers.authorization || '');
  return auth === `Bearer ${agentData.token}`;
}
function requireAgent(req, res) { if (agentAuthorized(req)) return true; json(res, 401, { ok: false, error: 'Jarvis não autorizado. Use o token de pareamento.' }); return false; }
function decodeBase64Url(value) { return Buffer.from(String(value || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); }
function extractHeader(headers, name) { return (headers || []).find(h => String(h.name).toLowerCase() === name.toLowerCase())?.value || ''; }
function googleConfigured() { return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET); }
function googleAuthUrl() {
  const params = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID || '', redirect_uri: googleRedirect, response_type: 'code', access_type: 'offline', prompt: 'consent', scope: googleScopes.join(' ') });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}
async function googleToken() {
  if (!agentData.google?.access_token) return null;
  if (agentData.google.expires_at && agentData.google.expires_at > Date.now() + 60000) return agentData.google.access_token;
  if (!agentData.google.refresh_token || !googleConfigured()) return null;
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: {'Content-Type':'application/x-www-form-urlencoded'}, body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, refresh_token: agentData.google.refresh_token, grant_type: 'refresh_token' }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error_description || 'Falha ao renovar Google OAuth');
  agentData.google = { ...agentData.google, ...data, expires_at: Date.now() + Number(data.expires_in || 3600) * 1000 };
  saveAgentData();
  return agentData.google.access_token;
}
async function googleApi(url, options = {}) {
  const token = await googleToken();
  if (!token) throw new Error('Google não conectado. Abra a tela de conexão do Jarvis.');
  const response = await fetch(url, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `Google API HTTP ${response.status}`);
  return data;
}
async function googleInbox(query = 'is:unread newer_than:7d') {
  const list = await googleApi(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=8&q=${encodeURIComponent(query)}`);
  const messages = [];
  for (const item of list.messages || []) {
    const full = await googleApi(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${item.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
    const headers = full.payload?.headers || [];
    messages.push({ id: item.id, from: extractHeader(headers, 'From'), subject: extractHeader(headers, 'Subject'), date: extractHeader(headers, 'Date'), snippet: full.snippet || '' });
  }
  return messages;
}
async function googleCalendar() {
  const now = new Date();
  const end = new Date(now.getTime() + 7 * 86400000);
  const data = await googleApi(`https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(now.toISOString())}&timeMax=${encodeURIComponent(end.toISOString())}&maxResults=15`);
  return (data.items || []).map(e => ({ id: e.id, title: e.summary || '(sem título)', start: e.start?.dateTime || e.start?.date, end: e.end?.dateTime || e.end?.date, location: e.location || '' }));
}
async function googleCreateEvent(title, start, minutes = 60) {
  const begin = new Date(start);
  const finish = new Date(begin.getTime() + minutes * 60000);
  return googleApi('https://www.googleapis.com/calendar/v3/calendars/primary/events', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ summary: title, start: { dateTime: begin.toISOString() }, end: { dateTime: finish.toISOString() }, reminders: { useDefault: true } }) });
}
function formatRate(bytesPerSecond) { const mbps = Number(bytesPerSecond || 0) * 8 / 1e6; return mbps.toFixed(mbps < 10 ? 2 : 1); }
function formatPcStatus(d) { return `CPU ${Math.round(d.cpu.usage)}%${d.cpu.temp != null ? ` / ${Math.round(d.cpu.temp)}°C` : ''}, GPU ${d.gpu ? `${Math.round(d.gpu.usage)}% / ${Math.round(d.gpu.temp)}°C` : 'offline'}, RAM ${Math.round(d.memory.usage)}%, download ${formatRate(d.network.down)} Mbps, upload ${formatRate(d.network.up)} Mbps.`; }
function addConversation(role, content) { agentData.conversations.push({ role, content, at: Date.now() }); agentData.conversations = agentData.conversations.slice(-40); saveAgentData(); }
function safeOpen(name) {
  const apps = { notepad: 'notepad.exe', bloco: 'notepad.exe', calculadora: 'calc.exe', calculator: 'calc.exe', explorer: 'explorer.exe', arquivos: 'explorer.exe', taskmgr: 'taskmgr.exe', tarefas: 'taskmgr.exe', discord: `${process.env.LOCALAPPDATA || ''}\\Discord\\Update.exe`, steam: 'steam.exe', spotify: 'spotify.exe', navegador: 'msedge.exe', edge: 'msedge.exe', brave: 'brave.exe' };
  const key = String(name || '').toLowerCase().trim();
  const target = apps[key];
  if (!target) throw new Error('Aplicativo fora da lista segura. Posso abrir: navegador, Discord, Steam, Spotify, explorador, bloco de notas, calculadora ou gerenciador de tarefas.');
  execFile(target, [], { windowsHide: true }, err => { if (err) console.error('Falha ao abrir app:', err.message); });
  return `Abrindo ${name}.`;
}
function parseReminder(text) {
  const relative = text.match(/(?:em|daqui a)\s+(\d+)\s*(minutos?|horas?|dias?)/i);
  if (!relative) return null;
  const amount = Number(relative[1]);
  const unit = relative[2].toLowerCase();
  const ms = unit.startsWith('hora') ? amount * 3600000 : unit.startsWith('dia') ? amount * 86400000 : amount * 60000;
  const clean = text.replace(/(?:me\s+)?lembre[- ]?me/i, '').replace(/(?:em|daqui a)\s+\d+\s*(?:minutos?|horas?|dias?)/i, '').replace(/^\s*(de|para)\s+/i, '').trim();
  return { text: clean || 'Lembrete do Jarvis', dueAt: Date.now() + ms };
}
async function runAgentCommand(input) {
  const text = String(input || '').trim();
  const lower = text.toLowerCase();
  if (!text) return 'Diga o que você precisa.';
  if (/^(ajuda|help|o que você pode|comandos)/i.test(text)) return 'Posso consultar o PC, abrir aplicativos seguros, listar lembretes, criar lembretes, consultar Gmail e agenda, criar eventos no Calendar e responder por voz.';
  const reminder = parseReminder(text);
  if (reminder) { agentData.reminders.push({ id: crypto.randomUUID(), ...reminder, done: false }); saveAgentData(); return `Lembrete criado para ${new Date(reminder.dueAt).toLocaleString('pt-BR')}: ${reminder.text}.`; }
  if (/lembretes?|reminders?/i.test(lower)) { const pending = agentData.reminders.filter(r => !r.done); return pending.length ? pending.map(r => `• ${r.text} — ${new Date(r.dueAt).toLocaleString('pt-BR')}`).join('\n') : 'Você não tem lembretes pendentes.'; }
  if (/^(abra|abrir|inicie|iniciar|launch)/i.test(lower)) return safeOpen(text.replace(/^(abra|abrir|inicie|iniciar|launch)\s+/i, '').replace(/o |a /i, ''));
  if (/status|saúde|temperatura|cpu|gpu|computador|pc/i.test(lower)) { const d = cache || await refresh(); return formatPcStatus(d); }
  if (/agenda|calendário|compromissos|eventos/i.test(lower)) { const events = await googleCalendar(); return events.length ? events.map(e => `• ${e.title} — ${new Date(e.start).toLocaleString('pt-BR')}${e.location ? ` (${e.location})` : ''}`).join('\n') : 'Não há eventos nos próximos 7 dias.'; }
  if (/email|gmail|caixa de entrada|mensagens/i.test(lower)) { const messages = await googleInbox(); return messages.length ? messages.map(m => `• ${m.subject || '(sem assunto)'} — ${m.from}\n  ${m.snippet}`).join('\n') : 'Nenhum email recente encontrado.'; }
  if (/^crie|agende|marque/i.test(lower) && /evento|reunião|compromisso/i.test(lower)) return 'Posso criar eventos no Google Calendar, mas preciso de título e horário exatos. Exemplo: “agende reunião amanhã às 14h”.';
  return 'Entendi, mas ainda não tenho uma ferramenta segura para essa ação. Tente “status do PC”, “abra o Discord”, “me lembre em 20 minutos de…”, “ver minha agenda” ou “ler meus emails”.';
}

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

function runPowerShell(script, timeout = 6000) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { timeout, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(err);
      resolve(String(stdout || '').trim());
    });
  });
}

async function diskHealthSnapshot() {
  const script = "Get-PhysicalDisk | Select-Object FriendlyName,HealthStatus,OperationalStatus,MediaType,Size,DeviceId | ConvertTo-Json -Compress";
  const raw = await runPowerShell(script);
  if (!raw) return { at: Date.now(), disks: [], error: 'Nenhum disco físico reportado' };
  const parsed = JSON.parse(raw);
  const list = (Array.isArray(parsed) ? parsed : [parsed]).map(d => ({
    name: d.FriendlyName || `Disk ${d.DeviceId ?? '?'}`,
    health: d.HealthStatus || 'Unknown',
    status: Array.isArray(d.OperationalStatus) ? d.OperationalStatus.join(', ') : (d.OperationalStatus || 'Unknown'),
    media: d.MediaType || 'Unknown',
    size: Number(d.Size || 0),
    deviceId: d.DeviceId ?? null
  }));
  return { at: Date.now(), disks: list, error: null };
}

async function refreshDiskHealth() {
  if (diskHealthCollecting) return diskHealthCollecting;
  diskHealthCollecting = diskHealthSnapshot()
    .then(data => (diskHealthCache = data))
    .catch(err => { diskHealthCache = { ...diskHealthCache, at: Date.now(), error: err.message }; return diskHealthCache; })
    .finally(() => { diskHealthCollecting = null; });
  return diskHealthCollecting;
}

function commandExists(command) {
  return new Promise(resolve => execFile('where.exe', [command], { timeout: 1800, windowsHide: true }, err => resolve(!err)));
}

async function diagnosticsSnapshot() {
  const checks = [];
  const add = (id, label, ok, detail) => checks.push({ id, label, ok: Boolean(ok), detail: detail || (ok ? 'Disponível' : 'Não encontrado') });
  add('node', 'Node.js', Boolean(process.version), process.version);
  add('dotnet', '.NET SDK', await commandExists('dotnet.exe'));
  add('fancontrol', 'FanControl', fs.existsSync(fanControlExe), fanControlExe);
  add('nvidia', 'NVIDIA SMI', await commandExists('nvidia-smi.exe'));
  const tshark = await commandExists('tshark.exe');
  add('npcap', 'Npcap / TShark', tshark, tshark ? 'Captura avançada disponível' : 'Instale Npcap + Wireshark para ativar');
  add('sensorBridge', 'Ponte de sensores', fs.existsSync(sensorBridge), sensorBridge);
  return { at: Date.now(), ok: checks.every(c => c.ok), checks };
}

async function refreshDiagnostics() {
  if (diagnosticsCollecting) return diagnosticsCollecting;
  diagnosticsCollecting = diagnosticsSnapshot()
    .then(data => (diagnosticsCache = data))
    .catch(err => { diagnosticsCache = { at: Date.now(), ok: false, checks: [{ id: 'diagnostics', label: 'Diagnóstico', ok: false, detail: err.message }] }; return diagnosticsCache; })
    .finally(() => { diagnosticsCollecting = null; });
  return diagnosticsCollecting;
}

async function networkAdvancedSnapshot() {
  const connections = connectionCache.at ? connectionCache : await refreshConnections();
  const groups = new Map();
  for (const row of connections.rows || []) {
    const key = row.process || `PID ${row.pid}`;
    const current = groups.get(key) || { process: key, pid: row.pid, connections: 0, external: 0, ports: new Set(), hosts: new Set() };
    current.connections += 1;
    if (row.external) current.external += 1;
    if (row.remote?.port) current.ports.add(row.remote.port);
    if (row.remote?.host) current.hosts.add(row.remote.host);
    groups.set(key, current);
  }
  const interfaces = (await si.networkInterfaces()).filter(i => i.operstate === 'up' && !i.internal && (i.ip4 || i.ip6)).map(i => ({ iface: i.iface, name: i.ifaceName || i.iface, speed: i.speed || null, ip4: i.ip4 || null, dhcp: Boolean(i.dhcp), virtual: Boolean(i.virtual) }));
  return { at: Date.now(), groups: [...groups.values()].sort((a, b) => b.external - a.external || b.connections - a.connections).slice(0, 20).map(g => ({ ...g, ports: [...g.ports], hosts: [...g.hosts].slice(0, 8) })), interfaces, capture: captureInfo };
}

async function refreshNetworkAdvanced() {
  if (networkAdvancedCollecting) return networkAdvancedCollecting;
  networkAdvancedCollecting = networkAdvancedSnapshot()
    .then(data => (networkAdvancedCache = data))
    .catch(err => { networkAdvancedCache = { ...networkAdvancedCache, at: Date.now(), error: err.message }; return networkAdvancedCache; })
    .finally(() => { networkAdvancedCollecting = null; });
  return networkAdvancedCollecting;
}

async function startCapture() {
  if (captureProcess) return captureInfo;
  if (!(await commandExists('tshark.exe'))) throw new Error('TShark não está instalado. Instale Wireshark com Npcap.');
  let interfaceIndex = '1';
  try {
    const listed = await new Promise((resolve, reject) => execFile('tshark.exe', ['-D'], { timeout: 3000, windowsHide: true }, (err, stdout) => err ? reject(err) : resolve(String(stdout || ''))));
    const lines = listed.split(/\r?\n/).filter(Boolean);
    const preferred = settings.interface === 'auto' ? /ethernet|wi-?fi|wireless/i : new RegExp(settings.interface.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const selected = lines.find(line => preferred.test(line) && !/radmin|hamachi|loopback|teredo|vpn|tunnel/i.test(line)) || lines.find(line => !/radmin|hamachi|loopback|teredo|vpn|tunnel/i.test(line));
    interfaceIndex = selected?.match(/^\s*(\d+)\./)?.[1] || '1';
  } catch {}
  const captureDir = path.join(__dirname, 'captures');
  fs.mkdirSync(captureDir, { recursive: true });
  const file = path.join(captureDir, `nightwatch-${new Date().toISOString().replace(/[:.]/g, '-')}.pcapng`);
  captureProcess = execFile('tshark.exe', ['-i', interfaceIndex, '-a', 'duration:60', '-c', '1000', '-w', file], { windowsHide: true }, (err) => {
    captureInfo = { ...captureInfo, active: false, error: err?.message || null };
    captureProcess = null;
  });
  captureInfo = { active: true, file, startedAt: Date.now(), interfaceIndex, error: null };
  return captureInfo;
}

function stopCapture() {
  if (captureProcess) { captureProcess.kill(); captureProcess = null; }
  captureInfo = { ...captureInfo, active: false };
  return captureInfo;
}

function persistHistory() {
  if (!historyDirty) return;
  try { fs.writeFileSync(historyFile, JSON.stringify(longHistory)); historyDirty = false; } catch (err) { console.error('Falha ao salvar histórico:', err.message); }
}

function computeAlerts(data) {
  const out = [];
  const t = settings.thresholds;
  if (data?.cpu?.temp != null && data.cpu.temp >= Number(t.cpuTemp)) out.push({ level: 'critical', code: 'CPU_TEMP', message: `CPU em ${Math.round(data.cpu.temp)}°C` });
  if (data?.gpu?.temp != null && data.gpu.temp >= Number(t.gpuTemp)) out.push({ level: 'critical', code: 'GPU_TEMP', message: `GPU em ${Math.round(data.gpu.temp)}°C` });
  for (const disk of data?.disks || []) if (Number(disk.usage) >= Number(t.diskUsage)) out.push({ level: 'warn', code: 'DISK_FULL', message: `${disk.mount || disk.name} em ${Math.round(disk.usage)}%` });
  for (const disk of diskHealthCache.disks || []) if (!/healthy|online|ok/i.test(`${disk.health} ${disk.status}`)) out.push({ level: 'critical', code: 'DISK_HEALTH', message: `${disk.name}: ${disk.health} / ${disk.status}` });
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
    hardware: hardwareCache,
    diskHealth: diskHealthCache
  };
  history.push({ t:now, cpu:data.cpu.usage, gpu:gpu?.usage || 0, down:speed.down, up:speed.up });
  if (history.length > 180) history.shift();
  longHistory.push({ t: now, cpu: Number(data.cpu.usage.toFixed(1)), gpu: Number((gpu?.usage || 0).toFixed(1)), ram: Number(data.memory.usage.toFixed(1)), down: Number(speed.down.toFixed(0)), up: Number(speed.up.toFixed(0)), cpuTemp: data.cpu.temp == null ? null : Number(data.cpu.temp.toFixed(1)), gpuTemp: gpu?.temp ?? null });
  const maxHistory = Math.max(360, Math.min(8640, Number(settings.historyHours || 24) * 60));
  if (longHistory.length > maxHistory) longHistory.splice(0, longHistory.length - maxHistory);
  historyDirty = true;
  data.networkHealth = networkHealthCache;
  data.processes = processCache;
  data.settings = settings;
  data.alerts = settings.alertsEnabled === false ? [] : computeAlerts(data);
  data.historyLong = longHistory.slice(-Math.min(longHistory.length, 720));
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
  const pathname = new URL(req.url, `http://${HOST}:${PORT}`).pathname;
  const rel = pathname === '/' ? 'index.html' : pathname === '/jarvis' ? 'jarvis.html' : pathname.replace(/^\/+/, '');
  const file = path.resolve(PUBLIC, rel);
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file)) { res.writeHead(404); return res.end('Not found'); }
  const ext = path.extname(file);
  const types = {'.html':'text/html; charset=utf-8','.css':'text/css','.js':'application/javascript','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml'};
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
  if (req.url === '/auth/google') {
    if (!googleConfigured()) { res.writeHead(503, {'Content-Type':'text/plain; charset=utf-8'}); res.end('Configure GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no ambiente do servidor.'); return; }
    res.writeHead(302, { Location: googleAuthUrl() }); res.end(); return;
  }
  if (req.url.startsWith('/auth/google/callback')) {
    try {
      const params = new URL(req.url, `http://${HOST}:${PORT}`).searchParams;
      if (params.get('error')) throw new Error(params.get('error_description') || params.get('error'));
      const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: {'Content-Type':'application/x-www-form-urlencoded'}, body: new URLSearchParams({ code: params.get('code') || '', client_id: process.env.GOOGLE_CLIENT_ID || '', client_secret: process.env.GOOGLE_CLIENT_SECRET || '', redirect_uri: googleRedirect, grant_type: 'authorization_code' }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error_description || 'Falha no login Google');
      agentData.google = { ...data, expires_at: Date.now() + Number(data.expires_in || 3600) * 1000 }; saveAgentData(); res.writeHead(302, { Location: '/jarvis?connected=google' }); res.end();
    } catch (e) { res.writeHead(500, {'Content-Type':'text/html; charset=utf-8'}); res.end(`<h1>Falha ao conectar Google</h1><p>${String(e.message).replace(/[<>]/g, '')}</p><p><a href="/jarvis">Voltar ao Jarvis</a></p>`); }
    return;
  }
  if (req.url.startsWith('/api/version')) {
    res.writeHead(200, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify({ version: APP_VERSION }));
    return;
  }
  if (req.url.startsWith('/api/agent/pairing')) {
    json(res, 200, { ok: true, token: agentData.token, host: HOST, port: PORT, googleConfigured: googleConfigured(), googleConnected: Boolean(agentData.google?.refresh_token || agentData.google?.access_token) });
    return;
  }
  if (req.url.startsWith('/api/agent/status')) {
    if (!requireAgent(req, res)) return;
    json(res, 200, { ok: true, agent: 'JARVIS', version: APP_VERSION, host: HOST, port: PORT, googleConfigured: googleConfigured(), googleConnected: Boolean(agentData.google?.refresh_token || agentData.google?.access_token), reminders: agentData.reminders.filter(r => !r.done).length, capabilities: ['pc.status', 'pc.open.safe', 'reminders.local', 'gmail.read', 'calendar.read', 'calendar.create'] });
    return;
  }
  if (req.url.startsWith('/api/agent/command') && req.method === 'POST') {
    if (!requireAgent(req, res)) return;
    try { const body = await readJson(req); const input = String(body.text || body.command || ''); addConversation('user', input); const answer = await runAgentCommand(input); addConversation('assistant', answer); json(res, 200, { ok: true, answer, at: Date.now() }); }
    catch (e) { json(res, 400, { ok: false, error: e.message }); }
    return;
  }
  if (req.url.startsWith('/api/agent/reminders')) {
    if (!requireAgent(req, res)) return;
    if (req.method === 'GET') { json(res, 200, { reminders: agentData.reminders.filter(r => !r.done) }); return; }
    if (req.method === 'DELETE') { const id = new URL(req.url, `http://${HOST}:${PORT}`).searchParams.get('id'); const item = agentData.reminders.find(r => r.id === id); if (item) item.done = true; saveAgentData(); json(res, 200, { ok: true }); return; }
  }
  if (req.url.startsWith('/api/agent/conversation')) {
    if (!requireAgent(req, res)) return;
    json(res, 200, { messages: agentData.conversations.slice(-30) }); return;
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
  if (req.url.startsWith('/api/network/advanced')) {
    try { const data = networkAdvancedCache.at ? networkAdvancedCache : await refreshNetworkAdvanced(); res.writeHead(200, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(data)); }
    catch (e) { res.writeHead(500, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:e.message})); }
    return;
  }
  if (req.url.startsWith('/api/network/capture/status')) {
    res.writeHead(200, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify({ ...captureInfo, tshark: await commandExists('tshark.exe') }));
    return;
  }
  if (req.url.startsWith('/api/network/capture/start') && req.method === 'POST') {
    try { const data = await startCapture(); res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify({ ok: true, ...data })); }
    catch (e) { res.writeHead(400, {'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,error:e.message})); }
    return;
  }
  if (req.url.startsWith('/api/network/capture/stop') && req.method === 'POST') {
    res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify({ ok: true, ...stopCapture() }));
    return;
  }
  if (req.url.startsWith('/api/disks')) {
    try { const data = diskHealthCache.at ? diskHealthCache : await refreshDiskHealth(); res.writeHead(200, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(data)); }
    catch (e) { res.writeHead(500, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:e.message})); }
    return;
  }
  if (req.url.startsWith('/api/diagnostics')) {
    try { const data = diagnosticsCache.at ? diagnosticsCache : await refreshDiagnostics(); res.writeHead(200, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(data)); }
    catch (e) { res.writeHead(500, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:e.message})); }
    return;
  }
  if (req.url.startsWith('/api/history')) {
    const hours = Math.max(1, Math.min(168, Number(new URL(req.url, `http://${HOST}:${PORT}`).searchParams.get('hours') || 24)));
    const cutoff = Date.now() - hours * 3600 * 1000;
    res.writeHead(200, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify({ at: Date.now(), hours, samples: longHistory.filter(s => s.t >= cutoff) }));
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
  refreshDiskHealth();
  refreshDiagnostics();
  refreshNetworkAdvanced();
  setInterval(refresh, 2000).unref();
  setInterval(refreshConnections, 5000).unref();
  setInterval(refreshNews, 15 * 60 * 1000).unref();
  setInterval(refreshHardware, 3000).unref();
  setInterval(refreshProcesses, 5000).unref();
  setInterval(refreshNetworkHealth, 10000).unref();
  setInterval(refreshDiskHealth, 60000).unref();
  setInterval(refreshDiagnostics, 30000).unref();
  setInterval(refreshNetworkAdvanced, 5000).unref();
  setInterval(persistHistory, 10000).unref();
});

process.on('SIGINT', () => { persistHistory(); stopCapture(); process.exit(0); });
process.on('SIGTERM', () => { persistHistory(); stopCapture(); process.exit(0); });
