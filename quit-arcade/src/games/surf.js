/* Urge Surfer: ride a craving's swell as it builds, peaks and passes.
 * Contract: window.QuitGames.surf.start(canvas, opts) / .stop()
 */
(function () {
  window.QuitGames = window.QuitGames || {};

  var TAU = Math.PI * 2;
  var PEAK = 0.35;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function ease(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function rand(a, b) { return a + Math.random() * (b - a); }

  // Craving curve: 0..1 over session progress p. Builds to PEAK, then fades to calm by ~95%.
  function urge(p) {
    if (p < PEAK) return 0.12 + 0.88 * ease(p / PEAK);
    return Math.pow(1 - ease((p - PEAK) / (0.95 - PEAK)), 1.15);
  }
  function phaseName(p) {
    if (p >= 1) return 'gone';
    if (p < PEAK - 0.06) return 'building';
    if (p < PEAK + 0.1) return 'peak';
    if (p < 0.93) return 'passing';
    return 'gone';
  }
  function hexA(hex, a) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  var S = null; // live game state; null when stopped

  function start(canvas, opts) {
    if (S) stop();
    opts = opts || {};
    var pal = opts.palette || {};
    var fonts = opts.fonts || {};
    var ctx = canvas.getContext('2d');
    var s = S = {
      canvas: canvas, ctx: ctx, opts: opts,
      pal: {
        bg: pal.bg || '#17122b', panel: pal.panel || '#221a40', ink: pal.ink || '#f3ecff',
        dim: pal.dim || '#a79cc9', pink: pal.pink || '#ff6b9a', mint: pal.mint || '#4fe3c1',
        amber: pal.amber || '#ffc857', red: pal.red || '#ff5d5d', blue: pal.blue || '#6aa9ff'
      },
      fDisp: fonts.display || 'monospace', fBody: fonts.body || 'sans-serif',
      duration: Math.max(5, +opts.duration || 180),
      rm: !!opts.reducedMotion,
      tips: Array.isArray(opts.tips) ? opts.tips.filter(Boolean) : [],
      W: 0, H: 0, dpr: 1,
      t: 0, scroll: 0, ending: 0, done: false, raf: 0, last: 0,
      player: { y: 0, vy: 0, onWave: true, tilt: 0 },
      holdPtr: false, holdKey: false,
      items: [], parts: [], pops: [], stars: [],
      spawnT: 0.8, score: 0, bubbles: 0, chain: 0, bestCombo: 0, chainT: 0,
      slowT: 0, hitT: 0, tipIdx: 0, tipT: 0, tipText: '', tipSlots: [], camY: 0,
      audio: null, listeners: [], ro: null
    };

    // Tip banners at a few evenly spaced moments (skip if no tips).
    if (s.tips.length) {
      var n = s.duration >= 90 ? 4 : 3;
      for (var i = 0; i < n; i++) s.tipSlots.push(s.duration * (0.14 + i * (0.72 / (n - 1 || 1))));
    }
    for (var k = 0; k < 40; k++) s.stars.push({ x: Math.random(), y: Math.random(), r: rand(0.5, 1.4), tw: rand(0, TAU) });

    if (!opts.muted) {
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (AC) s.audio = new AC();
      } catch (e) { s.audio = null; }
    }

    fit();
    s.player.y = waveY(s.W * 0.28) - 1;

    on(canvas, 'pointerdown', function (e) {
      s.holdPtr = true;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      if (s.audio && s.audio.state === 'suspended') s.audio.resume();
      e.preventDefault();
    });
    var release = function () { s.holdPtr = false; };
    on(canvas, 'pointerup', release);
    on(canvas, 'pointercancel', release);
    on(canvas, 'lostpointercapture', release);
    on(window, 'keydown', function (e) {
      if (e.code === 'Space' || e.key === ' ' || e.key === 'ArrowUp') {
        e.preventDefault();
        s.holdKey = true;
        if (s.audio && s.audio.state === 'suspended') s.audio.resume();
      }
    });
    on(window, 'keyup', function (e) {
      if (e.code === 'Space' || e.key === ' ' || e.key === 'ArrowUp') { e.preventDefault(); s.holdKey = false; }
    });
    on(window, 'blur', function () { s.holdKey = false; s.holdPtr = false; });
    on(document, 'visibilitychange', function () { s.last = 0; });

    if (window.ResizeObserver) {
      s.ro = new ResizeObserver(function () { if (S === s) fit(); });
      s.ro.observe(canvas);
    } else {
      on(window, 'resize', fit);
    }

    s.raf = requestAnimationFrame(loop);
  }

  function on(target, type, fn) {
    var o = type.indexOf('pointer') === 0 || type === 'keydown' ? { passive: false } : false;
    target.addEventListener(type, fn, o);
    S.listeners.push([target, type, fn, o]);
  }

  function cleanup(s) {
    if (!s) return;
    if (s.raf) cancelAnimationFrame(s.raf);
    s.raf = 0;
    s.listeners.forEach(function (l) { l[0].removeEventListener(l[1], l[2], l[3]); });
    s.listeners.length = 0;
    if (s.ro) { s.ro.disconnect(); s.ro = null; }
    if (s.audio) { try { s.audio.close(); } catch (e) { /* ignore */ } s.audio = null; }
    if (S === s) S = null;
  }

  function stop() { cleanup(S); }

  function fit() {
    var s = S, c = s.canvas;
    var w = Math.max(1, c.clientWidth || 320), h = Math.max(1, c.clientHeight || 440);
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var oldH = s.H;
    s.W = w; s.H = h; s.dpr = dpr;
    var bw = Math.round(w * dpr), bh = Math.round(h * dpr);
    if (c.width !== bw) c.width = bw;
    if (c.height !== bh) c.height = bh;
    s.u = Math.min(w, h) / 100;
    s.font = Math.max(11, Math.round(Math.min(w * 0.034, h * 0.05, 18)));
    s.hudH = Math.round(s.font * 3.4);
    s.seaY = h * 0.68;
    s.px = w * (w < h ? 0.26 : 0.24);
    s.pr = Math.max(7, s.u * 3.2);
    if (oldH && oldH !== h) {
      var k = h / oldH;
      s.player.y *= k;
      s.items.forEach(function (it) { it.y *= k; });
    }
  }

  function progress() { return clamp(S.t / S.duration, 0, 1); }
  function amp() {
    var s = S;
    return s.H * (0.025 + 0.15 * urge(progress())) + s.H * 0.008;
  }
  // Wave surface height at screen x (static in world space, scaled by current amplitude)
  function waveY(x) {
    var s = S, wx = x + s.scroll, L = Math.max(s.W, s.H * 0.9);
    var v = 0.62 * Math.sin(wx * TAU / (L * 0.95)) +
            0.28 * Math.sin(wx * TAU / (L * 0.41) + 1.3) +
            0.10 * Math.sin(wx * TAU / (L * 0.17) + 0.4);
    return s.seaY - amp() * v;
  }

  // ---------- audio ----------
  function blip(freq, dur, vol, type) {
    var a = S && S.audio;
    if (!a || a.state === 'closed') return;
    try {
      var t0 = a.currentTime, o = a.createOscillator(), g = a.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t0);
      o.frequency.exponentialRampToValueAtTime(freq * 1.5, t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol || 0.05, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(a.destination);
      o.start(t0); o.stop(t0 + dur + 0.02);
    } catch (e) { /* ignore */ }
  }

  // ---------- simulation ----------
  function spawn() {
    var s = S, p = progress(), c = urge(p);
    var x0 = s.W + s.pr * 3;
    var top = s.hudH + s.font * 2.2;
    var r = s.pr * 0.85;
    var roll = Math.random();
    var smokeChance = p > 0.9 ? 0 : 0.12 + 0.3 * c;
    if (roll < smokeChance) {
      var sy = clamp(waveY(x0) - rand(0.05, 0.32) * s.H, top, s.seaY);
      s.items.push({ type: 'smoke', x: x0, y: sy, r: s.pr * 1.5, ph: rand(0, TAU), drift: rand(0.08, 0.2) });
    } else if (roll < smokeChance + 0.08) {
      var cy = clamp(waveY(x0) - rand(0.2, 0.38) * s.H, top, s.seaY);
      s.items.push({ type: 'coin', x: x0, y: cy, r: r * 1.1, ph: 0 });
    } else {
      // A gentle arc of bubbles to chain together
      var count = 3 + Math.round(rand(0, 2 + 3 * c));
      var gap = Math.max(s.pr * 3, s.W * 0.055);
      var lift = rand(0.05, 0.22) * s.H, arc = rand(-0.12, 0.12) * s.H;
      for (var i = 0; i < count; i++) {
        var bx = x0 + i * gap, f = count > 1 ? i / (count - 1) : 0;
        var by = waveY(bx) - lift - Math.sin(f * Math.PI) * arc;
        s.items.push({ type: 'bubble', x: bx, y: clamp(by, top, s.seaY), r: r, ph: rand(0, TAU) });
      }
      return count * 0.12;
    }
    return 0;
  }

  function addParts(x, y, n, color, spd, life) {
    var s = S;
    if (s.rm) n = Math.min(n, 2);
    for (var i = 0; i < n; i++) {
      if (s.parts.length > (s.rm ? 30 : 220)) s.parts.shift();
      var a = rand(0, TAU), v = rand(0.3, 1) * spd;
      s.parts.push({ x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: life, max: life, color: color, r: rand(1, 2.4) * S.u * 0.5 + 1 });
    }
  }
  function popup(x, y, text, color) {
    S.pops.push({ x: x, y: y, text: text, color: color, life: 1 });
  }

  function update(dt) {
    var s = S, P = s.player, p = progress(), c = urge(p);
    if (!s.ending) s.t += dt;
    if (!s.ending && s.t >= s.duration) {
      s.ending = 0.0001;
      s.items = s.items.filter(function (it) { return it.type !== 'smoke'; });
      blip(523, 0.25, 0.05); blip(784, 0.4, 0.04);
    }
    if (s.ending) {
      s.ending += dt;
      if (s.ending >= 1.5 && !s.done) { finish(); return; }
    }

    var slow = s.slowT > 0 ? 0.6 : 1;
    var speed = s.W * 0.26 * (0.75 + 0.55 * c) * slow * (s.ending ? 0.5 : 1);
    s.scroll += speed * dt;

    // Player physics: hold to lift, release to drift back to the face. Never fails.
    var surf = waveY(s.px);
    var prevSurf = P.prevSurf == null ? surf : P.prevSurf;
    var surfVel = (surf - prevSurf) / Math.max(dt, 0.001);
    P.prevSurf = surf;
    var holding = s.holdPtr || s.holdKey;
    var g = s.H * 1.5, lift = s.H * 2.5 * (s.slowT > 0 ? 0.75 : 1);
    P.vy += (holding ? g - lift : g) * dt;
    P.vy *= Math.pow(0.3, dt);
    P.vy = clamp(P.vy, -s.H * 0.85, s.H * 0.95);
    P.y += P.vy * dt;
    var ceil = s.hudH + s.pr * 1.6;
    if (P.y < ceil) { P.y = ceil; if (P.vy < 0) P.vy *= 0.3; }
    P.onWave = false;
    if (P.y >= surf - s.pr * 0.6) {
      P.y = surf - s.pr * 0.6;
      if (P.vy > surfVel) P.vy = Math.min(surfVel, 0) * 1.05; // crests launch you gently
      P.onWave = true;
    }
    var slope = (waveY(s.px + 4) - waveY(s.px - 4)) / 8;
    var targetTilt = P.onWave ? Math.atan(slope) : clamp(P.vy / s.H, -0.5, 0.5);
    P.tilt += (targetTilt - P.tilt) * Math.min(1, dt * 8);

    // Spray off the board
    if (P.onWave && !s.rm && Math.random() < 0.6 + c * 0.4) {
      s.parts.push({ x: s.px - s.pr, y: P.y + s.pr * 0.5, vx: -rand(40, 120) * s.u * 0.2, vy: -rand(20, 90) * s.u * 0.2,
        life: 0.6, max: 0.6, color: s.pal.ink, r: rand(0.8, 1.8), grav: true });
    }

    // Spawning: density tracks the urge curve
    if (!s.ending) {
      s.spawnT -= dt;
      if (s.spawnT <= 0) {
        var extra = spawn();
        s.spawnT = lerp(1.7, 0.55, c) + extra + (p > 0.85 ? 0.8 : 0);
      }
    }

    // Items
    for (var i = s.items.length - 1; i >= 0; i--) {
      var it = s.items[i];
      it.ph += dt;
      it.x -= speed * dt * (it.type === 'smoke' ? 1 + it.drift : 1);
      if (it.type === 'smoke') it.y += Math.sin(it.ph * 1.6) * s.u * 3 * dt;
      if (it.x < -it.r * 3) { s.items.splice(i, 1); continue; }
      var dx = it.x - s.px, dy = it.y - P.y, rr = it.r + s.pr * (it.type === 'smoke' ? 0.6 : 1.1);
      if (dx * dx + dy * dy < rr * rr) { collect(it); s.items.splice(i, 1); }
    }

    if (s.chain > 0) { s.chainT -= dt; if (s.chainT <= 0) s.chain = 0; }
    if (s.slowT > 0) s.slowT -= dt;
    if (s.hitT > 0) s.hitT -= dt;

    // Particles / popups
    for (var j = s.parts.length - 1; j >= 0; j--) {
      var q = s.parts[j];
      q.life -= dt;
      if (q.life <= 0) { s.parts.splice(j, 1); continue; }
      if (q.grav) q.vy += s.H * 0.6 * dt;
      q.x += q.vx * dt; q.y += q.vy * dt;
    }
    for (var m = s.pops.length - 1; m >= 0; m--) {
      s.pops[m].life -= dt * 0.9;
      s.pops[m].y -= s.u * 8 * dt;
      if (s.pops[m].life <= 0) s.pops.splice(m, 1);
    }

    // Tips
    if (s.tipT > 0) s.tipT -= dt;
    if (s.tipSlots.length && !s.ending && s.t >= s.tipSlots[0]) {
      s.tipSlots.shift();
      s.tipText = s.tips[s.tipIdx % s.tips.length];
      s.tipIdx++;
      s.tipT = 5;
    }
    if (s.ending) s.tipT = Math.min(s.tipT, 0.4);

    // Gentle camera follow
    var target = s.rm ? 0 : clamp((P.y - s.seaY) * 0.08, -s.H * 0.03, s.H * 0.03);
    s.camY += (target - s.camY) * Math.min(1, dt * 2);
  }

  function collect(it) {
    var s = S, mult = 1 + Math.min(4, Math.floor(s.chain / 5));
    if (it.type === 'smoke') {
      if (s.chain >= 3) popup(it.x, it.y - it.r, 'combo lost', s.pal.dim);
      s.chain = 0; s.slowT = 1.2; s.hitT = 0.6;
      addParts(it.x, it.y, 6, s.pal.dim, s.u * 12, 0.7);
      blip(196, 0.18, 0.03, 'triangle');
      return;
    }
    s.chain++;
    s.chainT = 2.6;
    s.bestCombo = Math.max(s.bestCombo, s.chain);
    var newMult = 1 + Math.min(4, Math.floor(s.chain / 5));
    if (it.type === 'coin') {
      var pts = 50 * mult;
      s.score += pts;
      popup(it.x, it.y - it.r, '+' + pts, s.pal.amber);
      addParts(it.x, it.y, 12, s.pal.amber, s.u * 22, 0.6);
      blip(880, 0.12, 0.05); blip(1320, 0.18, 0.035);
    } else {
      var b = 10 * mult;
      s.score += b; s.bubbles++;
      popup(it.x, it.y - it.r, '+' + b, s.pal.mint);
      addParts(it.x, it.y, 8, s.pal.mint, s.u * 16, 0.5);
      blip(520 + Math.min(12, s.chain) * 30, 0.08, 0.04);
    }
    if (newMult > mult) { popup(s.px, S.player.y - s.pr * 3, 'x' + newMult + ' combo', s.pal.pink); blip(660, 0.2, 0.04, 'triangle'); }
  }

  function finish() {
    var s = S;
    s.done = true;
    var result = { score: Math.round(s.score), completed: true, bubbles: s.bubbles, bestCombo: s.bestCombo, seconds: Math.round(s.duration) };
    var cb = s.opts.onEnd;
    cleanup(s);
    if (typeof cb === 'function') cb(result);
  }

  // ---------- rendering ----------
  function draw() {
    var s = S, ctx = s.ctx, W = s.W, H = s.H, pal = s.pal, p = progress(), c = urge(p);
    ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);

    // Sky
    var sky = ctx.createLinearGradient(0, 0, 0, s.seaY);
    sky.addColorStop(0, pal.bg);
    sky.addColorStop(1, pal.panel);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // Stars fade as the sea calms toward dawn; sun rises as the urge passes
    for (var i = 0; i < s.stars.length; i++) {
      var st = s.stars[i];
      var a = (0.25 + 0.35 * Math.sin(s.t * 1.3 + st.tw) * (s.rm ? 0 : 1) + 0.35) * (1 - p * 0.6);
      ctx.fillStyle = hexA(pal.ink, clamp(a, 0, 1) * 0.6);
      ctx.fillRect(st.x * W, s.hudH + st.y * (s.seaY - s.hudH) * 0.75, st.r, st.r);
    }
    var sunY = lerp(s.seaY + H * 0.02, s.seaY - H * 0.24, ease(p));
    var sunR = Math.min(W, H) * 0.08;
    var glow = ctx.createRadialGradient(W * 0.72, sunY, sunR * 0.3, W * 0.72, sunY, sunR * 3);
    glow.addColorStop(0, hexA(pal.amber, 0.25 + 0.15 * p));
    glow.addColorStop(1, hexA(pal.amber, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, s.seaY + H * 0.1);
    ctx.fillStyle = hexA(pal.amber, 0.55 + 0.3 * p);
    ctx.beginPath(); ctx.arc(W * 0.72, sunY, sunR, 0, TAU); ctx.fill();

    ctx.save();
    ctx.translate(0, -s.camY);

    // Distant swells (parallax)
    swellLayer(0.25, s.seaY - H * 0.06, H * (0.01 + 0.03 * c), hexA(pal.blue, 0.18), 0.6);
    swellLayer(0.5, s.seaY - H * 0.025, H * (0.012 + 0.05 * c), hexA(pal.blue, 0.28), 0.35);

    // Main wave
    ctx.beginPath();
    ctx.moveTo(0, H + 50);
    var step = Math.max(4, W / 90);
    for (var x = 0; x <= W + step; x += step) ctx.lineTo(x, waveY(x));
    ctx.lineTo(W + step, H + 50);
    ctx.closePath();
    var sea = ctx.createLinearGradient(0, s.seaY - H * 0.2, 0, H);
    sea.addColorStop(0, pal.blue);
    sea.addColorStop(1, pal.bg);
    ctx.fillStyle = sea;
    ctx.fill();
    ctx.strokeStyle = hexA(pal.mint, 0.75);
    ctx.lineWidth = Math.max(1.5, s.u * 0.6);
    ctx.beginPath();
    for (var x2 = 0; x2 <= W + step; x2 += step) { var y2 = waveY(x2); if (x2 === 0) ctx.moveTo(x2, y2); else ctx.lineTo(x2, y2); }
    ctx.stroke();

    // Items
    s.items.forEach(drawItem);

    // Particles
    s.parts.forEach(function (q) {
      ctx.fillStyle = hexA(q.color, clamp(q.life / q.max, 0, 1) * 0.8);
      ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, TAU); ctx.fill();
    });

    drawPlayer();

    // Score popups
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    s.pops.forEach(function (pp) {
      ctx.font = Math.round(s.font * 1.05) + 'px ' + s.fDisp;
      ctx.fillStyle = hexA(pp.color, clamp(pp.life, 0, 1));
      ctx.fillText(pp.text, pp.x, pp.y);
    });
    ctx.restore();

    // Soft vignette tint when slowed by smoke
    if (s.hitT > 0 && !s.rm) {
      ctx.fillStyle = hexA(pal.red, 0.08 * (s.hitT / 0.6));
      ctx.fillRect(0, 0, W, H);
    }

    drawHud(p, c);
    drawTip();

    if (s.ending) {
      var e = clamp(s.ending / 0.4, 0, 1);
      ctx.fillStyle = hexA(pal.bg, 0.45 * e);
      ctx.fillRect(0, 0, W, H);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = Math.round(Math.min(W * 0.1, H * 0.09)) + 'px ' + s.fDisp;
      ctx.fillStyle = hexA(pal.mint, e);
      ctx.fillText('URGE PASSED', W / 2, H * 0.42);
      ctx.font = s.font + 'px ' + s.fBody;
      ctx.fillStyle = hexA(pal.ink, e * 0.85);
      ctx.fillText('You rode it out.', W / 2, H * 0.42 + Math.min(W * 0.1, H * 0.09));
    }
  }

  function swellLayer(par, base, a, color, wlMul) {
    var s = S, ctx = s.ctx, W = s.W, step = Math.max(6, W / 60);
    var off = s.scroll * (s.rm ? par * 0.5 : par), L = Math.max(W, s.H) * wlMul;
    ctx.beginPath();
    ctx.moveTo(0, s.H);
    for (var x = 0; x <= W + step; x += step) {
      var wx = x + off;
      ctx.lineTo(x, base - a * (0.7 * Math.sin(wx * TAU / L) + 0.3 * Math.sin(wx * TAU / (L * 0.37) + 2)));
    }
    ctx.lineTo(W + step, s.H);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  function drawItem(it) {
    var s = S, ctx = s.ctx, pal = s.pal;
    var bob = s.rm ? 0 : Math.sin(it.ph * 2.2) * s.u * 0.6;
    var y = it.y + bob;
    if (it.type === 'bubble') {
      ctx.fillStyle = hexA(pal.mint, 0.2);
      ctx.strokeStyle = hexA(pal.mint, 0.95);
      ctx.lineWidth = Math.max(1.5, s.u * 0.45);
      ctx.beginPath(); ctx.arc(it.x, y, it.r, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.fillStyle = hexA(pal.ink, 0.85);
      ctx.beginPath(); ctx.arc(it.x - it.r * 0.35, y - it.r * 0.35, it.r * 0.22, 0, TAU); ctx.fill();
    } else if (it.type === 'coin') {
      var sx = s.rm ? 1 : Math.abs(Math.cos(it.ph * 2.5)) * 0.7 + 0.3;
      ctx.save(); ctx.translate(it.x, y); ctx.scale(sx, 1);
      ctx.fillStyle = pal.amber;
      ctx.beginPath(); ctx.arc(0, 0, it.r, 0, TAU); ctx.fill();
      ctx.strokeStyle = hexA(pal.bg, 0.35); ctx.lineWidth = Math.max(1, s.u * 0.4);
      ctx.beginPath(); ctx.arc(0, 0, it.r * 0.6, 0, TAU); ctx.stroke();
      ctx.restore();
    } else {
      // Smoke puff: soft overlapping blobs, grey with a red tinge
      for (var k = 0; k < 4; k++) {
        var ang = k * 1.7 + it.ph * 0.6;
        var ox = Math.cos(ang) * it.r * 0.45, oy = Math.sin(ang) * it.r * 0.3;
        ctx.fillStyle = hexA(k % 2 ? pal.dim : pal.red, k % 2 ? 0.32 : 0.16);
        ctx.beginPath(); ctx.arc(it.x + ox, y + oy, it.r * (0.55 + 0.1 * k), 0, TAU); ctx.fill();
      }
    }
  }

  function drawPlayer() {
    var s = S, ctx = s.ctx, P = s.player, pal = s.pal, r = s.pr;
    ctx.save();
    ctx.translate(s.px, P.y);
    ctx.rotate(P.tilt);
    // Board
    ctx.fillStyle = pal.pink;
    ctx.beginPath();
    ctx.ellipse(0, r * 0.45, r * 1.9, r * 0.32, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = hexA(pal.ink, 0.7);
    ctx.fillRect(-r * 1.2, r * 0.4, r * 2.4, Math.max(1, r * 0.08));
    // Rider: simple rounded figure
    var lean = (s.holdPtr || s.holdKey) ? -0.15 : 0.1;
    ctx.rotate(lean);
    ctx.strokeStyle = pal.ink;
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(2, r * 0.32);
    ctx.beginPath();
    ctx.moveTo(-r * 0.5, r * 0.3); ctx.lineTo(0, -r * 0.5); ctx.lineTo(r * 0.5, r * 0.3); // legs
    ctx.moveTo(0, -r * 0.5); ctx.lineTo(0, -r * 1.3); // torso
    ctx.moveTo(-r * 0.9, -r * 1.0); ctx.lineTo(r * 0.9, -r * 1.15); // arms
    ctx.stroke();
    ctx.fillStyle = pal.ink;
    ctx.beginPath(); ctx.arc(0, -r * 1.75, r * 0.4, 0, TAU); ctx.fill();
    ctx.restore();
    if (s.slowT > 0 && !s.rm) {
      ctx.strokeStyle = hexA(s.pal.dim, 0.35 * (s.slowT / 1.2));
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(s.px, P.y - r * 0.6, r * 2.4, 0, TAU); ctx.stroke();
    }
  }

  function drawHud(p, c) {
    var s = S, ctx = s.ctx, W = s.W, pal = s.pal, f = s.font, h = s.hudH, pad = Math.max(10, f * 0.8);
    ctx.fillStyle = hexA(pal.panel, 0.92);
    ctx.fillRect(0, 0, W, h);
    ctx.fillStyle = hexA(pal.dim, 0.25);
    ctx.fillRect(0, h - 1, W, 1);

    ctx.textBaseline = 'middle';
    // Left: URGE + phase
    ctx.textAlign = 'left';
    ctx.font = Math.round(f * 1.15) + 'px ' + s.fDisp;
    ctx.fillStyle = pal.ink;
    ctx.fillText('URGE', pad, h * 0.34);
    var ph = phaseName(s.ending ? 1 : p);
    ctx.font = f + 'px ' + s.fBody;
    ctx.fillStyle = ph === 'peak' ? pal.pink : ph === 'gone' ? pal.mint : pal.dim;
    ctx.fillText(ph, pad, h * 0.72);
    var leftW = Math.max(ctx.measureText('building').width, f * 3.3) + pad * 1.6;

    // Right: time + score
    var remain = Math.max(0, Math.ceil(s.duration - s.t));
    var mm = Math.floor(remain / 60), ss = remain % 60;
    var time = mm + ':' + (ss < 10 ? '0' : '') + ss;
    ctx.textAlign = 'right';
    ctx.font = Math.round(f * 1.15) + 'px ' + s.fDisp;
    ctx.fillStyle = pal.ink;
    ctx.fillText(time, W - pad, h * 0.34);
    ctx.font = f + 'px ' + s.fBody;
    ctx.fillStyle = pal.amber;
    var scoreTxt = Math.round(s.score) + ' pts';
    ctx.fillText(scoreTxt, W - pad, h * 0.72);
    ctx.font = Math.round(f * 1.15) + 'px ' + s.fDisp;
    var rightW = Math.max(ctx.measureText('00:00').width, (ctx.font = f + 'px ' + s.fBody, ctx.measureText('00000 pts').width)) + pad * 1.6;

    // Center: the craving curve chart with a "now" marker
    var cx0 = leftW, cx1 = W - rightW, cy0 = h * 0.2, cy1 = h * 0.8;
    if (cx1 - cx0 > 30) {
      var cw = cx1 - cx0, chh = cy1 - cy0;
      ctx.beginPath();
      ctx.moveTo(cx0, cy1);
      for (var i = 0; i <= 48; i++) { var q = i / 48; ctx.lineTo(cx0 + q * cw, cy1 - urge(q) * chh); }
      ctx.lineTo(cx1, cy1);
      ctx.closePath();
      ctx.fillStyle = hexA(pal.blue, 0.14);
      ctx.fill();
      // past portion highlighted
      ctx.save();
      ctx.beginPath(); ctx.rect(cx0, 0, cw * p, h); ctx.clip();
      ctx.beginPath(); ctx.moveTo(cx0, cy1);
      for (var i2 = 0; i2 <= 48; i2++) { var q3 = i2 / 48; ctx.lineTo(cx0 + q3 * cw, cy1 - urge(q3) * chh); }
      ctx.lineTo(cx1, cy1); ctx.closePath();
      ctx.fillStyle = hexA(pal.mint, 0.3); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = hexA(pal.dim, 0.8);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (var j = 0; j <= 48; j++) { var q2 = j / 48, yy = cy1 - urge(q2) * chh; if (j) ctx.lineTo(cx0 + q2 * cw, yy); else ctx.moveTo(cx0, yy); }
      ctx.stroke();
      var nx = cx0 + p * cw, ny = cy1 - urge(p) * chh;
      ctx.strokeStyle = hexA(pal.ink, 0.35);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(nx, cy0 - 2); ctx.lineTo(nx, cy1 + 2); ctx.stroke();
      ctx.fillStyle = pal.pink;
      ctx.beginPath(); ctx.arc(nx, ny, Math.max(3, f * 0.28), 0, TAU); ctx.fill();
    }

    // Combo under the HUD
    if (s.chain >= 2 && !s.ending) {
      var mult = 1 + Math.min(4, Math.floor(s.chain / 5));
      ctx.textAlign = 'left';
      ctx.font = f + 'px ' + s.fDisp;
      ctx.fillStyle = hexA(pal.mint, 0.9);
      ctx.fillText('chain ' + s.chain + (mult > 1 ? '  x' + mult : ''), pad, h + f * 1.1);
    }
  }

  function drawTip() {
    var s = S;
    if (s.tipT <= 0 || !s.tipText) return;
    var ctx = s.ctx, W = s.W, H = s.H, f = s.font, pal = s.pal;
    var a = clamp(Math.min(s.tipT, 5 - s.tipT) / 0.4, 0, 1);
    ctx.font = f + 'px ' + s.fBody;
    var maxW = Math.min(W - 32, f * 34);
    var lines = wrap(ctx, s.tipText, maxW - f * 1.6);
    var lh = f * 1.35, bh = lines.length * lh + f * 1.1;
    var bw = maxW, bx = (W - bw) / 2, by = H - bh - Math.max(14, H * 0.04);
    ctx.fillStyle = hexA(pal.panel, 0.88 * a);
    roundRect(ctx, bx, by, bw, bh, f * 0.6); ctx.fill();
    ctx.strokeStyle = hexA(pal.mint, 0.5 * a);
    ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = hexA(pal.ink, a);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (var i = 0; i < lines.length; i++) ctx.fillText(lines[i], W / 2, by + f * 0.55 + lh * (i + 0.5));
  }

  function wrap(ctx, text, maxW) {
    var words = String(text).split(/\s+/), lines = [], line = '';
    for (var i = 0; i < words.length; i++) {
      var test = line ? line + ' ' + words[i] : words[i];
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = words[i]; } else line = test;
    }
    if (line) lines.push(line);
    return lines.slice(0, 3);
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function loop(now) {
    var s = S;
    if (!s) return;
    s.raf = requestAnimationFrame(loop);
    if (document.hidden) { s.last = 0; return; }
    var dt = s.last ? Math.min(0.05, Math.max(0, (now - s.last) / 1000)) : 0;
    s.last = now;
    if (dt > 0) update(dt);
    if (S === s) draw();
  }

  window.QuitGames.surf = { start: start, stop: stop };
})();
