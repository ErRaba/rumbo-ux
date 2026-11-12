/* Rumbo UX · control de acceso
   Cada dispositivo se identifica con una cuenta anónima de Firebase. El administrador lo autoriza
   desde admin.html; solo entonces puede leer la clave que descifra datos.bin. La clave se guarda
   en el dispositivo para usar la app sin conexión, con una verificación obligatoria cada 15 días. */
(function () {
  "use strict";
  const FB = window.RUMBO_FB || {}, SK = "rumbo.acceso", GRACE = 15 * 864e5;
  const BASE = `https://firestore.googleapis.com/v1/projects/${FB.projectId}/databases/(default)/documents/`;
  const st = () => { try { return JSON.parse(localStorage.getItem(SK)) || {}; } catch (e) { return {}; } };
  const save = s => { try { localStorage.setItem(SK, JSON.stringify(s)); } catch (e) {} };
  if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});

  /* ---------- pantalla de acceso ---------- */
  const css = document.createElement("style");
  css.textContent = `
  #gate{position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px 28px calc(env(safe-area-inset-bottom) + 32px);
    background:radial-gradient(120% 80% at 50% 20%,#14223d 0%,#070b14 70%);color:#f4efe6;text-align:center;transition:opacity .6s}
  #gate.out{opacity:0;pointer-events:none}
  #gate img{width:96px;height:96px;border-radius:24px;box-shadow:0 0 0 1px rgba(217,183,126,.25),0 20px 50px -20px #000}
  #gate h1{font-family:Fraunces,serif;font-weight:350;font-size:34px;letter-spacing:-.01em;margin:26px 0 6px}
  #gate .k{font-family:"JetBrains Mono",monospace;font-size:10px;letter-spacing:.24em;text-transform:uppercase;color:#d9b77e;opacity:.85}
  #gate p{font-family:Manrope,sans-serif;font-size:15px;line-height:1.55;color:rgba(244,239,230,.72);max-width:300px;margin:22px 0 0}
  #gate .code{font-family:"JetBrains Mono",monospace;font-size:28px;letter-spacing:.18em;color:#f0d6a6;margin:14px 0 4px}
  #gate input{width:100%;max-width:300px;margin-top:22px;height:50px;border-radius:14px;border:0;padding:0 18px;font:500 16px Manrope,sans-serif;color:#f4efe6;
    background:rgba(255,255,255,.04);box-shadow:0 0 0 1px rgba(217,183,126,.22) inset;outline:none;text-align:center}
  #gate input:focus{box-shadow:0 0 0 1px rgba(217,183,126,.6) inset}
  #gate button{width:100%;max-width:300px;margin-top:14px;height:54px;border-radius:16px;border:0;cursor:pointer;color:#f0d6a6;
    font:500 11px "JetBrains Mono",monospace;letter-spacing:.22em;text-transform:uppercase;background:linear-gradient(165deg,#15223b,#0d1627);box-shadow:0 0 0 1px rgba(217,183,126,.3) inset}
  #gate button:active{background:#18284a}
  #gate .spin{width:22px;height:22px;margin-top:26px;border-radius:50%;border:1.5px solid rgba(217,183,126,.2);border-top-color:#d9b77e;animation:gsp 1s linear infinite}
  @keyframes gsp{to{transform:rotate(360deg)}}`;
  document.head.appendChild(css);
  const gate = document.createElement("div"); gate.id = "gate"; document.body.appendChild(gate);
  const head = `<img src="iconos/icono-192.png" alt=""><h1>Rumbo UX</h1><div class="k">Rumbo a Air Europa · Boeing 737</div>`;
  const view = (body) => { gate.classList.remove("out"); gate.innerHTML = head + body; };
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const code = uid => { const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let h = 0, o = "";
    for (const ch of uid) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    for (let i = 0; i < 4; i++) { o += A[h % 32]; h = Math.floor(h / 32) + uid.charCodeAt(i) * 7; } return "RX-" + o; };

  /* ---------- Firebase por REST (sin SDK: más ligero y sin dependencias externas) ---------- */
  async function token() {
    const s = st();
    if (s.tok && s.exp > Date.now() + 60e3) return s;
    if (s.refresh) {
      const r = await fetch(`https://securetoken.googleapis.com/v1/token?key=${FB.apiKey}`, { method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=refresh_token&refresh_token=" + encodeURIComponent(s.refresh) });
      if (r.ok) { const j = await r.json(); Object.assign(s, { tok: j.id_token, refresh: j.refresh_token, uid: j.user_id, exp: Date.now() + j.expires_in * 1e3 }); save(s); return s; }
      if (r.status < 400 || r.status >= 500) throw new Error("red");
      delete s.refresh; delete s.uid; delete s.key;          // cuenta eliminada: empezar de cero
    }
    const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FB.apiKey}`, { method: "POST",
      headers: { "Content-Type": "application/json" }, body: '{"returnSecureToken":true}' });
    if (!r.ok) throw new Error("auth " + r.status);
    const j = await r.json(); Object.assign(s, { tok: j.idToken, refresh: j.refreshToken, uid: j.localId, exp: Date.now() + j.expiresIn * 1e3 }); save(s); return s;
  }
  async function fsReq(p, opt = {}) {
    const s = await token();
    const r = await fetch(BASE + p, { ...opt, headers: { Authorization: "Bearer " + s.tok, "Content-Type": "application/json" } });
    if (r.status === 404) return null;
    if (r.status === 403) return { denied: true };
    if (!r.ok) throw new Error("fs " + r.status);
    return r.json();
  }

  /* ---------- descifrar y arrancar la app ---------- */
  const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  function run(js) { const sc = document.createElement("script"); sc.textContent = js; document.body.appendChild(sc); }
  let started = false;
  async function openApp(key) {
    if (started) return true;
    try {
      const raw = await (await fetch("datos.bin")).arrayBuffer();
      const k = await crypto.subtle.importKey("raw", b64(key), "AES-GCM", false, ["decrypt"]);
      const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12) }, k, raw.slice(12));
      const txt = await new Response(new Blob([pt]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
      started = true; run(txt); run(document.getElementById("appjs").textContent);
      gate.classList.add("out"); setTimeout(() => gate.remove(), 700); return true;
    } catch (e) { const s = st(); delete s.key; save(s); return false; }   // clave antigua o datos dañados
  }

  /* ---------- verificación ---------- */
  function revoke() { const s = st(); delete s.key; delete s.ok; save(s); location.reload(); }
  async function verify(background) {
    const s = await token();
    const d = await fsReq("devices/" + s.uid);
    if (!d || d.denied) { if (background) return revoke(); return askAccess(s); }
    const ok = d.fields && d.fields.ok && d.fields.ok.booleanValue;
    if (!ok) { if (background) return revoke(); return waiting(s); }
    if (!s.key) {
      const k = await fsReq("config/key");
      if (!k || k.denied || !k.fields) throw new Error("sin clave");
      s.key = k.fields.k.stringValue;
    }
    s.ok = Date.now(); save(s);
    fsReq(`devices/${s.uid}?updateMask.fieldPaths=visto`, { method: "PATCH", body: JSON.stringify({ fields: { visto: { timestampValue: new Date().toISOString() } } }) }).catch(() => {});
    if (!background && !(await openApp(s.key))) { const t = st(); delete t.key; save(t); return verify(false); }
  }
  function askAccess(s) {
    view(`<p>Este dispositivo todavía no tiene acceso. Escribe tu nombre y envía la solicitud.</p>
      <input id="gName" maxlength="40" placeholder="Tu nombre" autocomplete="name"><button id="gSend">Solicitar acceso</button>`);
    const n = gate.querySelector("#gName"), b = gate.querySelector("#gSend");
    b.onclick = async () => {
      const nombre = n.value.trim(); if (!nombre) { n.focus(); return; }
      b.disabled = true; b.textContent = "Enviando…";
      try {
        const r = await fsReq(`devices?documentId=${s.uid}`, { method: "POST", body: JSON.stringify({ fields: {
          ok: { booleanValue: false }, code: { stringValue: code(s.uid) }, nombre: { stringValue: nombre },
          creado: { timestampValue: new Date().toISOString() }, ua: { stringValue: navigator.userAgent.slice(0, 180) } } }) });
        if (r && r.denied) throw new Error("denegado");
        waiting(s);
      } catch (e) { b.disabled = false; b.textContent = "Solicitar acceso"; offline("No se pudo enviar la solicitud. Comprueba la conexión."); }
    };
  }
  let poll;
  function waiting(s) {
    view(`<p>Solicitud enviada. Cuando el administrador la apruebe, la app se abrirá sola.</p>
      <div class="code">${code(s.uid)}</div><div class="k">Código de este dispositivo</div>
      <button id="gChk">Comprobar ahora</button>`);
    gate.querySelector("#gChk").onclick = () => check();
    clearTimeout(poll); poll = setTimeout(async () => {     // consulta silenciosa cada 15 s
      try { const d = await fsReq("devices/" + s.uid);
        if (d && d.fields && d.fields.ok && d.fields.ok.booleanValue) return check();
        if (!d) return askAccess(s); } catch (e) {}
      waiting(s); }, 15000);
  }
  function offline(msg) {
    view(`<p>${esc(msg || "Necesitas conexión a internet para verificar el acceso (la primera vez y al menos cada 15 días).")}</p><button id="gRe">Reintentar</button>`);
    gate.querySelector("#gRe").onclick = () => check();
  }
  async function check() {
    clearTimeout(poll); view(`<div class="spin"></div>`);
    try { await verify(false); } catch (e) { offline(); }
  }

  /* ---------- arranque ---------- */
  (async function boot() {
    if (!FB.apiKey) { view(`<p>Configuración pendiente.</p>`); return; }
    const s = st();
    if (s.key && Date.now() - (s.ok || 0) < GRACE) {
      view(`<div class="spin"></div>`);
      if (await openApp(s.key)) { verify(true).catch(() => {}); return; }   // abre al instante; revisa en segundo plano
    }
    check();
  })();
  document.addEventListener("visibilitychange", () => { if (!document.hidden && started) verify(true).catch(() => {}); });
})();
