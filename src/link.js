// Ma3madan Link: connects a phone to a laptop app (Ma3madan Play now, Ma3madan PPT later)
// with WebRTC.
//
// - The pairing key is made by the laptop and reaches the phone only inside the QR code.
// - To find each other, both leave a few small messages at the signaling server
//   (ma3madan-remote.pages.dev/api/signal): the room is a hash of the key, and every message is
//   encrypted with a key derived from it, so the server can neither read nor forge them.
// - Then the two talk directly over the Wi-Fi through an encrypted data channel; no server is
//   involved any more, and the remote keeps working if the internet drops.
//
// The same file is used by the phone app and by Ma3madan Play (copy it to both when it changes).
(function (root) {
  const SIGNAL = 'https://ma3madan-remote.pages.dev/api/signal';
  const ICE_SERVERS = [{ urls: 'stun:stun.cloudflare.com:3478' }];
  const enc = new TextEncoder(), dec = new TextDecoder();

  const toB64 = bytes => { let s = ''; for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b); return btoa(s); };
  const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const hex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');

  function randomId(bytes = 9) {
    const a = crypto.getRandomValues(new Uint8Array(bytes));
    return toB64(a).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  // { room, key } from the pairing key.
  async function deriveLink(secret) {
    const roomHash = await crypto.subtle.digest('SHA-256', enc.encode('ma3madan-room:' + secret));
    const keyBytes = await crypto.subtle.digest('SHA-256', enc.encode('ma3madan-key:' + secret));
    const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
    return { room: hex(roomHash).slice(0, 32), key };
  }

  async function seal(key, obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
    return toB64(iv) + '.' + toB64(data);
  }
  async function unseal(key, sealed) {
    const [iv, data] = sealed.split('.');
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv) }, key, fromB64(data));
    return JSON.parse(dec.decode(plain));
  }

  async function send(link, from, to, obj) {
    const r = await fetch(`${SIGNAL}?room=${link.room}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' }, // a "simple" request: no CORS preflight
      body: JSON.stringify({ from, to, data: await seal(link.key, obj) }),
    });
    if (!r.ok) throw new Error('signal ' + r.status);
  }

  // Messages for `me` after the id `after`: [{ id, from, msg }]. Anything that doesn't decrypt
  // (not from a paired device) is dropped.
  async function receive(link, me, after) {
    const r = await fetch(`${SIGNAL}?room=${link.room}&for=${encodeURIComponent(me)}&after=${after}`, { cache: 'no-store' });
    if (!r.ok) throw new Error('signal ' + r.status);
    const { messages = [] } = await r.json();
    const out = [];
    for (const m of messages) {
      try { out.push({ id: m.id, from: m.from_id, msg: await unseal(link.key, m.data) }); }
      catch { out.push({ id: m.id, from: m.from_id, msg: null }); }
    }
    return out;
  }

  // Wait until the connection has gathered its addresses (so one offer and one answer suffice).
  function gathered(pc, ms = 2500) {
    return new Promise(done => {
      if (pc.iceGatheringState === 'complete') return done();
      const t = setTimeout(done, ms);
      pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); done(); } });
    });
  }

  root.MaLink = { SIGNAL, ICE_SERVERS, randomId, deriveLink, send, receive, gathered };
})(typeof window !== 'undefined' ? window : globalThis);
