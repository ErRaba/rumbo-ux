/* Rumbo UX · control de acceso con código personal
   Cada persona tiene un código que le da el administrador. Al escribirlo, el dispositivo queda activado
   (sin esperar aprobación). Cada persona tiene un máximo de dispositivos a la vez: si se activa uno más,
   el más antiguo pierde el acceso. La clave que descifra datos.bin solo la leen dispositivos activos y se
   guarda en el dispositivo para usar la app sin conexión, con una comprobación silenciosa cada 15 días. */
(function () {
  "use strict";
  const FB = window.RUMBO_FB || {}, SK = "rumbo.acceso", GRACE = 15 * 864e5;
  const ROOT = `projects/${FB.projectId}/databases/(default)/documents`, BASE = `https://firestore.googleapis.com/v1/${ROOT}/`;
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
  #gate p.err{color:#de8f7b;font-size:14px;margin-top:14px;min-height:22px}
  #gate input{width:100%;max-width:300px;margin-top:22px;height:54px;border-radius:14px;border:0;padding:0 18px;font:500 19px "JetBrains Mono",monospace;letter-spacing:.14em;color:#f0d6a6;
    background:rgba(255,255,255,.04);box-shadow:0 0 0 1px rgba(217,183,126,.22) inset;outline:none;text-align:center;text-transform:uppercase}
  #gate input::placeholder{color:rgba(244,239,230,.25);letter-spacing:.1em}
  #gate input:focus{box-shadow:0 0 0 1px rgba(217,183,126,.6) inset}
  #gate button{width:100%;max-width:300px;margin-top:14px;height:54px;border-radius:16px;border:0;cursor:pointer;color:#f0d6a6;
    font:500 11px "JetBrains Mono",monospace;letter-spacing:.22em;text-transform:uppercase;background:linear-gradient(165deg,#15223b,#0d1627);box-shadow:0 0 0 1px rgba(217,183,126,.3) inset}
  #gate button:active{background:#18284a}
  #gate button:disabled{opacity:.5}
  #gate .spin{width:22px;height:22px;margin-top:26px;border-radius:50%;border:1.5px solid rgba(217,183,126,.2);border-top-color:#d9b77e;animation:gsp 1s linear infinite}
  @keyframes gsp{to{transform:rotate(360deg)}}`;
  document.head.appendChild(css);
  const gate = document.createElement("div"); gate.id = "gate"; document.body.appendChild(gate);
  const head = `<img src="iconos/icono-192.png" alt=""><h1>Rumbo UX</h1><div class="k">Rumbo a Air Europa · Boeing 737</div>`;
  const view = body => { gate.classList.remove("out"); gate.innerHTML = head + body; };
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* ---------- Firebase por REST (sin SDK) ---------- */
  async function token() {
    const s = st();
    if (s.tok && s.exp > Date.now() + 60e3) return s;
    if (s.refresh) {
      const r = await fetch(`https://securetoken.googleapis.com/v1/token?key=${FB.apiKey}`, { method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=refresh_token&refresh_token=" + encodeURIComponent(s.refresh) });
      if (r.ok) { const j = await r.json(); Object.assign(s, { tok: j.id_token, refresh: j.refresh_token, uid: j.user_id, exp: Date.now() + j.expires_in * 1e3 }); save(s); return s; }
      if (r.status < 400 || r.status >= 500) throw new Error("red");
      delete s.refresh; delete s.uid; delete s.tok;      // identidad perdida: se crea otra (el código la reactiva)
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
  const fStr = (d, k) => d && d.fields && d.fields[k] && d.fields[k].stringValue;
  const fInt = (d, k) => d && d.fields && d.fields[k] ? +(d.fields[k].integerValue || d.fields[k].doubleValue || 0) : 0;
  const fUids = d => ((d && d.fields && d.fields.uids && d.fields.uids.arrayValue.values) || []).map(v => v.stringValue);
  const norm = c => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

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
    } catch (e) { const s = st(); delete s.key; save(s); return false; }
  }

  /* ---------- verificación ---------- */
  // Devuelve "ok" o el motivo por el que este dispositivo ya no tiene acceso.
  async function status() {
    const s = await token();
    const d = await fsReq("devices/" + s.uid);
    const code = fStr(d, "codigo"), p = fStr(d, "persona");
    if (!d || d.denied || !code || !p) return { why: "nuevo" };
    const c = await fsReq("codigos/" + code);
    if (!c || c.denied || fStr(c, "persona") !== p) return { why: "codigo" };
    const a = await fsReq("activos/" + p);
    if (!fUids(a).includes(s.uid)) return { why: "otro" };
    if (s.persona !== p) { s.persona = p; save(s); }
    return { why: "ok", s };
  }
  const MSG = { codigo: "Tu código de acceso ha cambiado. Escribe el nuevo.", otro: "Tu código se ha usado en otro dispositivo y este ha dejado de estar activo. Escríbelo de nuevo para recuperarlo." };
  function lock(why) { const s = st(); delete s.key; delete s.ok; s.why = why; save(s); location.reload(); }
  async function verify(background) {
    const r = await status();
    if (r.why !== "ok") { if (background) return lock(r.why); return askCode(MSG[r.why] || st().why && MSG[st().why]); }
    const s = r.s;
    if (!s.key) {
      const k = await fsReq("config/key");
      if (!k || k.denied || !k.fields) throw new Error("sin clave");
      s.key = k.fields.k.stringValue;
    }
    s.ok = Date.now(); delete s.why; save(s);
    fsReq(`devices/${s.uid}?updateMask.fieldPaths=visto`, { method: "PATCH", body: JSON.stringify({ fields: { visto: { timestampValue: new Date().toISOString() } } }) }).catch(() => {});
    if (!background && !(await openApp(s.key))) { const t = st(); delete t.key; save(t); throw new Error("descifrado"); }
    sync(true); progSync(true);
  }
  /* ---------- uso: resumen de estadísticas para el panel del administrador ----------
     Se guarda siempre en el dispositivo; se envía cuando hay conexión (al abrir, al salir y cada 5 min). */
  let lastSync = 0;
  async function sync(force) {
    if (!started || typeof window.RUMBO_USO !== "function" || !navigator.onLine) return;
    if (!force && Date.now() - lastSync < 5 * 60e3) return;
    lastSync = Date.now();
    try {
      const s = await token(); if (!s.persona) return;
      await fetch(BASE + "uso/" + s.uid, { method: "PATCH", keepalive: true,
        headers: { Authorization: "Bearer " + s.tok, "Content-Type": "application/json" },
        body: JSON.stringify({ fields: { persona: { stringValue: s.persona }, actualizado: { timestampValue: new Date().toISOString() },
          ua: { stringValue: navigator.userAgent.slice(0, 180) }, datos: { stringValue: JSON.stringify(window.RUMBO_USO()).slice(0, 60000) } } }) });
    } catch (e) {}
  }
  setInterval(() => { if (!document.hidden) sync(false); }, 60e3);

  /* ---------- copia del progreso completo (por persona) ----------
     Al abrir con conexión: si en la nube hay una copia más reciente hecha desde otro dispositivo
     (o desde esta misma app antes de reinstalarla), se fusiona. Después, si hay cambios, se sube. */
  const PK = "rumbo.prog";
  const pm = () => { try { return JSON.parse(localStorage.getItem(PK)) || {}; } catch (e) { return {}; } };
  const pmSave = m => { try { localStorage.setItem(PK, JSON.stringify(m)); } catch (e) {} };
  async function gz(str) {
    const b = new Uint8Array(await new Response(new Blob([str]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
    let s = ""; for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode.apply(null, b.subarray(i, i + 32768)); return btoa(s);
  }
  const gunz = z => new Response(new Blob([b64(z)]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
  let progBusy = false, lastProg = 0;
  async function progSync(pull) {
    const P = window.RUMBO_PROG;
    if (progBusy || !started || !P || !navigator.onLine || typeof CompressionStream === "undefined") return;
    progBusy = true;
    try {
      const s = await token(); if (!s.persona) return;
      const m = pm();
      if (pull) {
        const d = await fsReq("progreso/" + s.persona);
        if (d && !d.denied && d.fields && d.fields.z) {
          const rt = Date.parse(d.fields.t.timestampValue);
          if (rt > (m.rt || 0) && fStr(d, "uid") !== s.uid) {
            if (P.busy()) return;                                   // en mitad de una sesión: se fusiona la próxima vez
            if (P.merge(await gunz(d.fields.z.stringValue), rt)) { m.rt = rt; pmSave(m); }
          }
        }
      }
      const ver = P.ver();
      if (ver === m.ver) return;
      const z = await gz(P.get()), now = new Date();
      const r = await fetch(BASE + "progreso/" + s.persona, { method: "PATCH",
        headers: { Authorization: "Bearer " + s.tok, "Content-Type": "application/json" },
        body: JSON.stringify({ fields: { z: { stringValue: z }, t: { timestampValue: now.toISOString() }, uid: { stringValue: s.uid },
          n: { stringValue: ver } } }) });
      if (r.ok) { Object.assign(m, { ver, up: now.getTime(), rt: Math.max(m.rt || 0, now.getTime()) }); pmSave(m); P.saved && P.saved(); }
    } catch (e) {} finally { progBusy = false; lastProg = Date.now(); }
  }
  setInterval(() => { if (!document.hidden && Date.now() - lastProg > 5 * 60e3) progSync(false); }, 60e3);
  async function activate(raw) {
    const code = norm(raw);
    if (code.length < 6) return "Escribe el código completo.";
    const s = await token();
    const c = await fsReq("codigos/" + code);
    if (!c || c.denied) return "Ese código no es válido. Revísalo o pide uno nuevo.";
    const p = fStr(c, "persona"), max = Math.max(1, fInt(c, "max") || 1);
    const a = await fsReq("activos/" + p);
    const uids = fUids(a).filter(u => u !== s.uid).concat(s.uid).slice(-max);
    const now = new Date().toISOString();
    const r = await fetch(`https://firestore.googleapis.com/v1/${ROOT}:commit`, { method: "POST",
      headers: { Authorization: "Bearer " + s.tok, "Content-Type": "application/json" },
      body: JSON.stringify({ writes: [
        { update: { name: `${ROOT}/devices/${s.uid}`, fields: { codigo: { stringValue: code }, persona: { stringValue: p },
          creado: { timestampValue: now }, visto: { timestampValue: now }, ua: { stringValue: navigator.userAgent.slice(0, 180) } } } },
        { update: { name: `${ROOT}/activos/${p}`, fields: { uids: { arrayValue: { values: uids.map(u => ({ stringValue: u })) } } } } }] }) });
    if (!r.ok) return r.status === 403 ? "Ese código no es válido. Revísalo o pide uno nuevo." : "No se pudo activar. Comprueba la conexión.";
    return null;
  }
  function askCode(msg) {
    view(`<p>${esc(msg || "Escribe tu código de acceso personal.")}</p>
      <input id="gCode" maxlength="24" placeholder="NOMBRE-XXXXXX" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false">
      <button id="gGo">Entrar</button><p class="err" id="gErr"></p>`);
    const n = gate.querySelector("#gCode"), b = gate.querySelector("#gGo"), e = gate.querySelector("#gErr");
    const go = async () => {
      if (!n.value.trim()) { n.focus(); return; }
      b.disabled = true; b.textContent = "Comprobando…"; e.textContent = "";
      try {
        const err = await activate(n.value);
        if (err) { e.textContent = err; b.disabled = false; b.textContent = "Entrar"; return; }
        view(`<div class="spin"></div>`); await verify(false);
      } catch (x) { offline("No se pudo comprobar el código. Revisa la conexión e inténtalo de nuevo."); }
    };
    b.onclick = go; n.addEventListener("keydown", ev => { if (ev.key === "Enter") go(); });
  }
  function offline(msg) {
    view(`<p>${esc(msg || "Necesitas conexión a internet para verificar el acceso (la primera vez y al menos cada 15 días).")}</p><button id="gRe">Reintentar</button>`);
    gate.querySelector("#gRe").onclick = () => check();
  }
  async function check() {
    view(`<div class="spin"></div>`);
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
  document.addEventListener("visibilitychange", () => { if (!started) return; if (document.hidden) { sync(true); progSync(false); } else verify(true).catch(() => {}); });
})();
