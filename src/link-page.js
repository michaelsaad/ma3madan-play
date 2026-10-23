// The page side of the phone link (see hub.js), the same in Ma3madan Play and Ma3madan PPT.
// - When this app holds the link, link-host.js runs here, and this passes what phones say to the
//   hub and what the hub sends back to the phones.
// - Either way, the app talks to its phones only through LinkPage: send() its state or a reply,
//   onMessage() for commands, onStatus() for the Remote panel.
// eslint-disable-next-line no-unused-vars
const LinkPage = (() => {
  const L = window.api.link;
  let apps = [], onMessage = () => {}, onStatus = () => {}, onRequest = async () => 'deny', onCancel = () => {};
  let status = { on: false, role: 'off' };

  // ---------- holding the link ----------
  L.on('link-host-start', async ({ identity, apps: a }) => {
    apps = a || [];
    try {
      await LinkHost.start(identity, {
        apps: () => apps,
        onNet: (peer, msg) => L.send('link-host-net', { peer, msg }),
        onPeers: list => L.send('link-host-peers', list),
        onOnline: v => L.send('link-host-online', v),
        onRequest: req => onRequest(req),
        onCancel: code => onCancel(code),
        trust: req => L.invoke('link-host-trust', req),
        seen: id => L.send('link-host-seen', id),
      });
      L.send('link-host-online', LinkHost.isOnline() ?? false);
    } catch (e) { console.warn('link', e); }
  });
  L.on('link-host-identity', identity => LinkHost.setIdentity(identity));
  L.on('link-host-apps', a => { apps = a || []; LinkHost.announce(); });
  L.on('link-host-send', ({ peer, msg }) => LinkHost.send(peer, msg));
  L.on('link-host-stop', () => LinkHost.stop());

  // ---------- this app ----------
  L.on('link-app-in', msg => onMessage(msg));
  L.on('link-status', s => { status = s || {}; onStatus(status); });
  L.invoke('link-status');

  return {
    send: msg => L.send('link-app-out', msg),
    op: o => L.invoke('link-op', o),
    status: () => status,
    set onMessage(fn) { onMessage = fn; },
    set onStatus(fn) { onStatus = fn; onStatus(status); },
    set onRequest(fn) { onRequest = fn; },
    set onCancel(fn) { onCancel = fn; },
  };
})();
