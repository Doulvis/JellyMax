// Google Cast pour Windows : découverte des appareils (mDNS) et protocole Cast v2, sans dépendance externe.
// Le contenu est lu par l'application "Default Media Receiver" de Google, directement depuis le serveur Jellyfin.
const dgram = require('node:dgram');
const os = require('node:os');
const tls = require('node:tls');
const { EventEmitter } = require('node:events');

const SERVICE = '_googlecast._tcp.local';
const DEFAULT_RECEIVER = 'CC1AD845';
const NS = {
  connection: 'urn:x-cast:com.google.cast.tp.connection',
  heartbeat: 'urn:x-cast:com.google.cast.tp.heartbeat',
  receiver: 'urn:x-cast:com.google.cast.receiver',
  media: 'urn:x-cast:com.google.cast.media',
};

// ---------------------------------------------------------------------------
// Découverte mDNS
// ---------------------------------------------------------------------------

function encodeName(name) {
  const parts = name.split('.').map((l) => {
    const b = Buffer.from(l, 'utf8');
    return Buffer.concat([Buffer.from([b.length]), b]);
  });
  return Buffer.concat([...parts, Buffer.from([0])]);
}

/** Requête PTR avec réponse unicast demandée (bit QU), envoyée depuis un port quelconque. */
function queryPacket() {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(1, 4); // une question
  const tail = Buffer.alloc(4);
  tail.writeUInt16BE(12, 0); // PTR
  tail.writeUInt16BE(0x8001, 2); // IN + QU
  return Buffer.concat([header, encodeName(SERVICE), tail]);
}

function readName(buf, offset) {
  const labels = [];
  let off = offset;
  let end = -1;
  for (let guard = 0; guard < 128 && off < buf.length; guard++) {
    const len = buf[off];
    if (len === 0) {
      off++;
      break;
    }
    if ((len & 0xc0) === 0xc0) {
      if (end < 0) end = off + 2;
      off = ((len & 0x3f) << 8) | buf[off + 1];
      continue;
    }
    labels.push(buf.toString('utf8', off + 1, off + 1 + len));
    off += len + 1;
  }
  return [labels.join('.'), end >= 0 ? end : off];
}

function parsePacket(buf) {
  const records = [];
  if (buf.length < 12) return records;
  const qd = buf.readUInt16BE(4);
  const total = buf.readUInt16BE(6) + buf.readUInt16BE(8) + buf.readUInt16BE(10);
  let off = 12;
  for (let i = 0; i < qd; i++) off = readName(buf, off)[1] + 4;
  for (let i = 0; i < total && off + 10 <= buf.length; i++) {
    const [name, o] = readName(buf, off);
    const type = buf.readUInt16BE(o);
    const len = buf.readUInt16BE(o + 8);
    const data = o + 10;
    off = data + len;
    if (off > buf.length) break;
    const r = { name: name.toLowerCase(), rawName: name, type };
    if (type === 12) r.target = readName(buf, data)[0];
    else if (type === 33) {
      r.port = buf.readUInt16BE(data + 4);
      r.target = readName(buf, data + 6)[0].toLowerCase();
    } else if (type === 16) {
      r.txt = {};
      for (let p = data; p < data + len; ) {
        const l = buf[p];
        const s = buf.toString('utf8', p + 1, p + 1 + l);
        const eq = s.indexOf('=');
        if (eq > 0) r.txt[s.slice(0, eq)] = s.slice(eq + 1);
        p += l + 1;
      }
    } else if (type === 1 && len === 4) r.ip = `${buf[data]}.${buf[data + 1]}.${buf[data + 2]}.${buf[data + 3]}`;
    else continue;
    records.push(r);
  }
  return records;
}

/**
 * Recherche les appareils Cast du réseau local tant que la fonction retournée n'est pas appelée.
 * onChange reçoit la liste complète à chaque nouvel appareil.
 */
function discover(onChange) {
  const devices = new Map(); // instance -> appareil
  const srv = new Map();
  const txt = new Map();
  const hosts = new Map();
  const sockets = [];

  const rebuild = () => {
    let changed = false;
    for (const [instance, s] of srv) {
      const ip = hosts.get(s.target);
      const t = txt.get(instance) || {};
      if (!ip) continue;
      const id = t.id || instance;
      const prev = devices.get(instance);
      const name = t.fn || instance.split('.')[0];
      if (prev && prev.host === ip && prev.name === name) continue;
      // Bit 0 de "ca" : sortie vidéo. Les enceintes et barres de son ne peuvent pas lire de film.
      const ca = Number(t.ca);
      if (t.ca != null && isFinite(ca) && !(ca & 1)) continue;
      devices.set(instance, { id, name, model: t.md || '', host: ip, port: s.port });
      changed = true;
    }
    if (changed) onChange([...devices.values()]);
  };

  const onMessage = (msg) => {
    let records;
    try {
      records = parsePacket(msg);
    } catch {
      return;
    }
    for (const r of records) {
      if (r.type === 33) srv.set(r.name, { port: r.port, target: r.target });
      else if (r.type === 16) txt.set(r.name, r.txt);
      else if (r.type === 1) hosts.set(r.name, r.ip);
    }
    rebuild();
  };

  // Une requête par interface réseau IPv4 (Wi-Fi, Ethernet…), pour ne pas dépendre de l'interface par défaut.
  const addrs = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) addrs.push(a.address);
  }
  const packet = queryPacket();
  for (const addr of addrs) {
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    sock.on('error', () => {});
    sock.on('message', onMessage);
    sock.bind(0, addr, () => {
      try {
        sock.setMulticastInterface(addr);
        sock.setMulticastTTL(255);
      } catch {
        /* ignore */
      }
      sockets.push(sock);
      sock.send(packet, 5353, '224.0.0.251', () => {});
    });
  }
  const timer = setInterval(() => {
    for (const s of sockets) s.send(packet, 5353, '224.0.0.251', () => {});
  }, 3000);

  return () => {
    clearInterval(timer);
    for (const s of sockets) {
      try {
        s.close();
      } catch {
        /* ignore */
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Protocole Cast v2 : messages protobuf "CastMessage" sur TLS, préfixés par leur longueur
// ---------------------------------------------------------------------------

function varint(n) {
  const out = [];
  while (n > 0x7f) {
    out.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  out.push(n);
  return Buffer.from(out);
}

function stringField(num, s) {
  const b = Buffer.from(s, 'utf8');
  return Buffer.concat([varint((num << 3) | 2), varint(b.length), b]);
}

function encodeMessage(source, dest, namespace, data) {
  return Buffer.concat([
    Buffer.from([0x08, 0x00]), // protocol_version = CASTV2_1_0
    stringField(2, source),
    stringField(3, dest),
    stringField(4, namespace),
    Buffer.from([0x28, 0x00]), // payload_type = STRING
    stringField(6, data),
  ]);
}

function decodeMessage(buf) {
  const msg = {};
  let off = 0;
  const readVarint = () => {
    let n = 0;
    let shift = 0;
    for (;;) {
      const b = buf[off++];
      n += (b & 0x7f) * 2 ** shift;
      if (b < 0x80) return n;
      shift += 7;
    }
  };
  while (off < buf.length) {
    const key = readVarint();
    const num = key >>> 3;
    const wire = key & 7;
    if (wire === 0) readVarint();
    else if (wire === 2) {
      const len = readVarint();
      const s = buf.toString('utf8', off, off + len);
      off += len;
      if (num === 2) msg.source = s;
      else if (num === 3) msg.dest = s;
      else if (num === 4) msg.namespace = s;
      else if (num === 6) msg.data = s;
    } else break;
  }
  return msg;
}

class CastConnection extends EventEmitter {
  constructor(host, port) {
    super();
    this.host = host;
    this.port = port;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.requestId = 1;
    this.pending = new Map();
    this.heartbeat = null;
    this.lastPong = 0;
  }

  open() {
    return new Promise((resolve, reject) => {
      const sock = tls.connect({ host: this.host, port: this.port, rejectUnauthorized: false, timeout: 10000 });
      this.socket = sock;
      sock.once('secureConnect', () => {
        sock.setTimeout(0);
        this.send('receiver-0', NS.connection, { type: 'CONNECT' });
        this.lastPong = Date.now();
        this.heartbeat = setInterval(() => {
          // Plus de réponse depuis 20 s : l'appareil a disparu du réseau.
          if (Date.now() - this.lastPong > 20000) return this.close();
          this.send('receiver-0', NS.heartbeat, { type: 'PING' });
        }, 5000);
        resolve();
      });
      sock.once('timeout', () => {
        sock.destroy(new Error('timeout'));
      });
      sock.on('error', (e) => {
        reject(e);
        this.close();
      });
      sock.on('close', () => this.close());
      sock.on('data', (chunk) => this.onData(chunk));
    });
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 4) {
      const len = this.buffer.readUInt32BE(0);
      if (this.buffer.length < 4 + len) break;
      const msg = decodeMessage(this.buffer.subarray(4, 4 + len));
      this.buffer = this.buffer.subarray(4 + len);
      if (msg.data == null) continue;
      let data;
      try {
        data = JSON.parse(msg.data);
      } catch {
        continue;
      }
      this.lastPong = Date.now();
      if (msg.namespace === NS.heartbeat) {
        if (data.type === 'PING') this.send(msg.source, NS.heartbeat, { type: 'PONG' });
        continue;
      }
      if (msg.namespace === NS.connection && data.type === 'CLOSE') {
        this.emit('app-closed', msg.source);
        continue;
      }
      const waiter = data.requestId ? this.pending.get(data.requestId) : null;
      if (waiter) {
        this.pending.delete(data.requestId);
        waiter(data);
      }
      this.emit('message', msg.namespace, data, msg.source);
    }
  }

  send(dest, namespace, data) {
    if (!this.socket || this.socket.destroyed) return;
    const body = encodeMessage('sender-0', dest, namespace, JSON.stringify(data));
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length, 0);
    this.socket.write(Buffer.concat([len, body]));
  }

  request(dest, namespace, data, timeoutMs = 15000) {
    const requestId = this.requestId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('Cast: pas de réponse de l’appareil'));
      }, timeoutMs);
      this.pending.set(requestId, (res) => {
        clearTimeout(timer);
        resolve(res);
      });
      this.send(dest, namespace, { ...data, requestId });
    });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.heartbeat);
    for (const w of this.pending.values()) w({ type: 'CLOSED' });
    this.pending.clear();
    if (this.socket) this.socket.destroy();
    this.emit('close');
  }
}

/**
 * Session sur un appareil : lance le récepteur par défaut, charge les médias et relaie leur état.
 * Événement 'status' : { connected, state, time, duration, idleReason, volume, muted }.
 */
class CastSession extends EventEmitter {
  constructor(device) {
    super();
    this.device = device;
    this.conn = new CastConnection(device.host, device.port);
    this.transportId = null;
    this.sessionId = null;
    this.mediaSessionId = null;
    this.volume = { level: 1, muted: false };
    this.media = { state: 'IDLE', time: 0, duration: 0, idleReason: null };
    this.poll = null;
    this.ended = false;
  }

  async start() {
    this.conn.on('close', () => this.finish());
    this.conn.on('app-closed', (src) => {
      if (src === this.transportId) this.finish();
    });
    this.conn.on('message', (ns, data) => this.onMessage(ns, data));
    await this.conn.open();
    const res = await this.conn.request('receiver-0', NS.receiver, { type: 'LAUNCH', appId: DEFAULT_RECEIVER }, 30000);
    const app = res.status && (res.status.applications || []).find((a) => a.appId === DEFAULT_RECEIVER);
    if (!app) throw new Error(res.reason || 'Cast: impossible de lancer la lecture sur cet appareil');
    this.transportId = app.transportId;
    this.sessionId = app.sessionId;
    if (res.status.volume) this.volume = res.status.volume;
    this.conn.send(this.transportId, NS.connection, { type: 'CONNECT' });
    this.poll = setInterval(() => {
      if (this.transportId) this.conn.send(this.transportId, NS.media, { type: 'GET_STATUS', requestId: 0 });
    }, 1000);
  }

  onMessage(ns, data) {
    if (ns === NS.receiver && data.type === 'RECEIVER_STATUS' && data.status) {
      if (data.status.volume) this.volume = data.status.volume;
      const apps = data.status.applications || [];
      // Une autre application a pris la main sur l'appareil, ou la lecture a été arrêtée depuis la TV.
      if (this.sessionId && !apps.some((a) => a.sessionId === this.sessionId)) return this.finish();
      this.emitStatus();
    } else if (ns === NS.media && data.type === 'MEDIA_STATUS') {
      const s = (data.status || [])[0];
      if (s) {
        this.mediaSessionId = s.mediaSessionId;
        this.media = {
          state: s.playerState || 'IDLE',
          time: s.currentTime || 0,
          duration: (s.media && s.media.duration) || this.media.duration,
          idleReason: s.idleReason || null,
        };
      } else if (this.mediaSessionId) {
        this.media = { ...this.media, state: 'IDLE' };
      }
      this.emitStatus();
    }
  }

  emitStatus() {
    this.emit('status', {
      connected: !this.ended,
      ...this.media,
      volume: this.volume.level != null ? this.volume.level : 1,
      muted: !!this.volume.muted,
    });
  }

  async load(m) {
    const res = await this.conn.request(
      this.transportId,
      NS.media,
      {
        type: 'LOAD',
        autoplay: true,
        currentTime: m.startTime || 0,
        media: {
          contentId: m.url,
          contentUrl: m.url,
          contentType: m.contentType,
          streamType: 'BUFFERED',
          duration: m.duration || undefined,
          metadata: {
            metadataType: m.subtitle ? 2 : 1, // TV_SHOW / MOVIE
            title: m.title,
            subtitle: m.subtitle || undefined,
            seriesTitle: m.subtitle ? m.title : undefined,
            images: m.image ? [{ url: m.image }] : [],
          },
        },
      },
      60000,
    );
    if (res.type !== 'MEDIA_STATUS') throw new Error(`Cast: ${res.reason || res.type || 'échec du chargement'}`);
    this.onMessage(NS.media, res);
  }

  control(cmd) {
    if (cmd.type === 'VOLUME') {
      this.conn.send('receiver-0', NS.receiver, { type: 'SET_VOLUME', volume: { level: cmd.level }, requestId: 0 });
      return;
    }
    if (!this.mediaSessionId || !this.transportId) return;
    const msg = { type: cmd.type, mediaSessionId: this.mediaSessionId, requestId: 0 };
    if (cmd.type === 'SEEK') msg.currentTime = cmd.time;
    this.conn.send(this.transportId, NS.media, msg);
  }

  async stop() {
    if (this.ended) return;
    try {
      if (this.sessionId) await this.conn.request('receiver-0', NS.receiver, { type: 'STOP', sessionId: this.sessionId }, 5000);
    } catch {
      /* ignore */
    }
    this.finish();
  }

  finish() {
    if (this.ended) return;
    this.ended = true;
    clearInterval(this.poll);
    this.conn.close();
    this.emit('status', { connected: false, ...this.media, volume: 1, muted: false });
  }
}

module.exports = { discover, CastSession };
