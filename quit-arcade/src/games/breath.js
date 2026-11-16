(function () {
  'use strict';
  window.QuitGames = window.QuitGames || {};

  var INHALE = 4, CYCLE = 10;       // seconds: 4 in + 6 out = 6 breaths per minute
  var END_HOLD = 1.5;               // "NICE AND SLOW" moment
  var S = null;                     // active session (null when stopped)

  var clamp = function (x, a, b) { return Math.max(a, Math.min(b, x)); };

  // Guide ribbon height (0..1) at time tt: eased rise for 4s, eased fall for 6s.
  function guide(tt) {
    var c = ((tt % CYCLE) + CYCLE) % CYCLE;
    return c < INHALE ? (1 - Math.cos(Math.PI * c / INHALE)) / 2
                      : (1 + Math.cos(Math.PI * (c - INHALE) / (CYCLE - INHALE))) / 2;
  }

  // '#rrggbb' + alpha -> rgba() string (palette colours only, alpha variations)
  function rgba(hex, a) {
    var h = String(hex).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  function start(canvas, opts) {
    stop();
    opts = opts || {};
    var P = opts.palette, F = opts.fonts;
    var duration = opts.duration > 0 ? opts.duration : 60;
    var totalBreaths = Math.max(1, Math.round(duration / CYCLE));
    var reduced = !!opts.reducedMotion;
    var ctx = canvas.getContext('2d');

    var s = S = {
      raf: 0, last: 0, t: 0, v: 0, vel: 0, hold: false, phase: 'play', endT: 0,
      syncAcc: 0, syncT: 0, collected: 0, dots: [], bursts: [], stars: [], clouds: [],
      W: 0, H: 0, dpr: 1, L: null, ro: null, audio: null, listeners: []
    };

    // ---- world setup (normalised coordinates so resizing is trivial) ----
    for (var i = 0; i < 70; i++) s.stars.push({ x: Math.random(), y: Math.random() * 0.9, r: 0.6 + Math.random() * 1.2, layer: i % 3, ph: Math.random() * 6.28 });
    for (i = 0; i < 6; i++) s.clouds.push({ x: Math.random(), y: 0.25 + Math.random() * 0.65, w: 0.18 + Math.random() * 0.2, layer: i % 2 });
    for (var k = 1; k * 0.5 <= duration - 0.25; k++) s.dots.push({ t: k * 0.5, state: 0 });

    // ---- sizing ----
    function fit() {
      var W = canvas.clientWidth || 320, H = canvas.clientHeight || 440;
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      s.W = W; s.H = H; s.dpr = dpr;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var pad = W < 420 ? 12 : 18, f1 = clamp(W * 0.035, 12, 16);
      var titleY = pad + f1 + 10;
      var title = fitSize('BREATHE OUT', F.display, clamp(W * 0.07, 20, 34), W - pad * 2);
      var subSize = clamp(W * 0.04, 13, 18), subY = titleY + title * 1.1 + 2;
      var hb = subY + subSize * 1.2 + 8, hw = clamp(Math.min(W, H) * 0.045, 14, 26);
      s.L = { pad: pad, f1: f1, titleY: titleY, title: title, subY: subY, sub: subSize, hw: hw,
              lx: W * 0.26, speed: W * 0.14, yTop: hb + hw * 3.3, yBot: H - 12 - hw * 1.8 };
    }
    function fitSize(str, font, size, maxW) {
      ctx.font = size + 'px ' + font;
      while (size > 11 && ctx.measureText(str).width > maxW) { size -= 1; ctx.font = size + 'px ' + font; }
      return size;
    }
    var yOf = function (val) { return s.L.yBot - val * (s.L.yBot - s.L.yTop); };

    // ---- audio (lazy, only when opts.muted === false) ----
    if (opts.muted === false) {
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        var ac = new AC(), osc = ac.createOscillator(), gain = ac.createGain();
        osc.type = 'sine'; gain.gain.value = 0;
        osc.connect(gain); gain.connect(ac.destination); osc.start();
        gain.gain.setTargetAtTime(0.025, ac.currentTime, 0.5);
        s.audio = { ac: ac, osc: osc, gain: gain };
      } catch (e) { s.audio = null; }
    }
    function audioUpdate() {
      var a = s.audio; if (!a) return;
      try {
        if (a.ac.state === 'suspended') a.ac.resume();
        a.osc.frequency.setTargetAtTime(196 + 130 * guide(s.t), a.ac.currentTime, 0.15);
        if (s.phase === 'end') a.gain.gain.setTargetAtTime(0, a.ac.currentTime, 0.3);
      } catch (e) {}
    }

    // ---- input ----
    function on(target, type, fn, o) { target.addEventListener(type, fn, o); s.listeners.push([target, type, fn, o]); }
    function press(e) {
      if (e && e.pointerId !== undefined) { try { canvas.setPointerCapture(e.pointerId); } catch (x) {} }
      s.hold = true;
    }
    function release() { s.hold = false; }
    on(canvas, 'pointerdown', function (e) { e.preventDefault(); press(e); });
    on(canvas, 'pointerup', release);
    on(canvas, 'pointercancel', release);
    on(canvas, 'lostpointercapture', release);
    on(window, 'keydown', function (e) {
      if (e.code !== 'Space' && e.key !== ' ') return;
      e.preventDefault();
      if (!e.repeat) press();
    });
    on(window, 'keyup', function (e) {
      if (e.code !== 'Space' && e.key !== ' ') return;
      e.preventDefault(); release();
    });
    on(window, 'blur', release);
    on(document, 'visibilitychange', function () { s.last = 0; release(); });

    // ---- simulation ----
    function update(dt) {
      s.t += dt;
      var holding = s.hold && s.phase === 'play';
      // eased rise (~4s) and sink (~6s): slow near the ends, quicker mid-way
      var rate = (0.7 + 0.9 * Math.sin(Math.PI * s.v)) / (holding ? INHALE : CYCLE - INHALE);
      s.vel += ((holding ? 1 : -1) * rate - s.vel) * Math.min(1, dt * 5);
      s.v = clamp(s.v + s.vel * dt, 0, 1);

      if (s.phase === 'play') {
        var d = Math.abs(s.v - guide(s.t));
        s.syncAcc += clamp(1 - d / 0.4, 0, 1) * dt; s.syncT += dt;
        for (var i = 0; i < s.dots.length; i++) {
          var dot = s.dots[i];
          if (dot.state === 0 && s.t >= dot.t) {
            var near = Math.abs(s.v - guide(dot.t)) < 0.22;
            dot.state = near ? 1 : 2;
            if (near) {
              s.collected++;
              if (!reduced) s.bursts.push({ x: s.L.lx, y: yOf(s.v), age: 0 });
            }
          }
        }
        if (s.t >= duration) { s.phase = 'end'; s.endT = 0; s.hold = false; }
      } else {
        s.endT += dt;
        if (s.endT >= END_HOLD) finish();
      }
      for (var b = s.bursts.length - 1; b >= 0; b--) { s.bursts[b].age += dt; if (s.bursts[b].age > 0.7) s.bursts.splice(b, 1); }
      audioUpdate();
    }
    var syncPct = function () { return s.syncT > 0 ? Math.round(100 * s.syncAcc / s.syncT) : 0; };

    // ---- drawing ----
    function drawSky() {
      var W = s.W, H = s.H, g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, P.bg); g.addColorStop(1, P.panel);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      var scroll = reduced ? 0 : s.t;
      s.stars.forEach(function (st) {
        var x = (((st.x * W - scroll * W * 0.012 * (st.layer + 1)) % W) + W) % W;
        var tw = reduced ? 0.7 : 0.55 + 0.35 * Math.sin(s.t * 1.3 + st.ph);
        ctx.fillStyle = rgba(P.ink, tw * (0.35 + st.layer * 0.2));
        ctx.beginPath(); ctx.arc(x, st.y * H, st.r, 0, 6.283); ctx.fill();
      });
      s.clouds.forEach(function (c) {
        var cw = c.w * W, span = W + cw * 2;
        var x = (((c.x * span - scroll * W * (0.02 + c.layer * 0.02)) % span) + span) % span - cw;
        ctx.fillStyle = rgba(P.blue, 0.07 + c.layer * 0.04);
        [[0, 0, 0.5, 0.22], [-0.28, 0.05, 0.32, 0.16], [0.28, 0.06, 0.34, 0.16]].forEach(function (p) {
          ctx.beginPath(); ctx.ellipse(x + p[0] * cw, c.y * H + p[1] * cw * 0.5, p[2] * cw, p[3] * cw, 0, 0, 6.283); ctx.fill();
        });
      });
    }

    function drawRibbon() {
      var L = s.L, W = s.W;
      function trace(x0, x1) {
        ctx.beginPath(); var started = false;
        for (var x = x0; x <= x1 + 0.5; x += 5) {
          var tt = s.t + (x - L.lx) / L.speed;
          if (tt < 0 || tt > duration) continue;
          var y = yOf(guide(tt));
          if (started) ctx.lineTo(x, y); else { ctx.moveTo(x, y); started = true; }
        }
      }
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      [[0, L.lx, 0.2], [L.lx, W, 0.6]].forEach(function (seg) {
        trace(seg[0], seg[1]);
        ctx.strokeStyle = rgba(P.pink, seg[2] * 0.25); ctx.lineWidth = 10; ctx.stroke();
        ctx.strokeStyle = rgba(P.pink, seg[2]); ctx.lineWidth = 3; ctx.stroke();
      });
      var r = clamp(W * 0.012, 3.5, 6);
      s.dots.forEach(function (d) {
        var x = L.lx + (d.t - s.t) * L.speed;
        if (x < -10 || x > W + 10 || d.state === 1) return;
        var y = yOf(guide(d.t));
        ctx.fillStyle = d.state === 2 ? rgba(P.dim, 0.35) : P.mint;
        if (d.state === 0) { ctx.shadowColor = P.mint; ctx.shadowBlur = reduced ? 0 : 10; }
        ctx.beginPath(); ctx.arc(x, y, d.state === 2 ? r * 0.7 : r, 0, 6.283); ctx.fill();
        ctx.shadowBlur = 0;
      });
      s.bursts.forEach(function (b) {
        ctx.strokeStyle = rgba(P.mint, 1 - b.age / 0.7); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(b.x, b.y, L.hw * (1.2 + b.age * 2.5), 0, 6.283); ctx.stroke();
      });
    }

    function countNow() {
      var p = s.t % CYCLE;
      return p < INHALE ? Math.ceil(INHALE - p) : Math.ceil(CYCLE - p);
    }

    function drawLantern() {
      var L = s.L, x = L.lx, y = yOf(s.v), hw = L.hw, hh = hw * 1.25, g = guide(s.t);
      // breathing circle follows the guide: grows on inhale, shrinks on exhale
      var R = hw * (1.7 + 1.5 * g), inhale = s.t % CYCLE < INHALE;
      ctx.fillStyle = rgba(P.mint, 0.07 + 0.06 * g); ctx.beginPath(); ctx.arc(x, y, R, 0, 6.283); ctx.fill();
      ctx.strokeStyle = rgba(inhale ? P.mint : P.blue, 0.6); ctx.lineWidth = 2; ctx.stroke();
      // glow
      var pulse = reduced ? 1 : 1 + 0.12 * Math.sin(s.t * 2.2), gr = hw * 3 * pulse;
      var rg = ctx.createRadialGradient(x, y, 0, x, y, gr);
      rg.addColorStop(0, rgba(P.amber, 0.5)); rg.addColorStop(1, rgba(P.amber, 0));
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(x, y, gr, 0, 6.283); ctx.fill();
      // paper body
      var bg = ctx.createRadialGradient(x, y, hw * 0.1, x, y, hw * 1.2);
      bg.addColorStop(0, rgba(P.ink, 0.95)); bg.addColorStop(0.45, P.amber); bg.addColorStop(1, P.pink);
      ctx.fillStyle = bg; ctx.beginPath(); ctx.ellipse(x, y, hw, hh, 0, 0, 6.283); ctx.fill();
      ctx.strokeStyle = rgba(P.bg, 0.22); ctx.lineWidth = 1;
      [0.55, 0].forEach(function (f) { ctx.beginPath(); ctx.ellipse(x, y, hw * f || 0.5, hh, 0, 0, 6.283); ctx.stroke(); });
      ctx.fillStyle = P.pink;
      ctx.fillRect(x - hw * 0.5, y - hh - 2, hw, 4); ctx.fillRect(x - hw * 0.5, y + hh - 2, hw, 4);
      ctx.strokeStyle = P.amber; ctx.beginPath(); ctx.moveTo(x, y + hh + 2); ctx.lineTo(x, y + hh + hw * 0.6); ctx.stroke();
      if (s.phase === 'play') {
        ctx.fillStyle = P.bg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = '600 ' + Math.max(11, Math.round(hw * 0.95)) + 'px ' + F.body;
        ctx.fillText(String(countNow()), x, y + 1);
      }
    }

    function drawHud() {
      var L = s.L, W = s.W, H = s.H;
      ctx.textBaseline = 'top';
      ctx.font = L.f1 + 'px ' + F.body; ctx.fillStyle = P.dim;
      ctx.textAlign = 'left';
      ctx.fillText('breath ' + Math.min(totalBreaths, Math.floor(s.t / CYCLE) + 1) + ' of ' + totalBreaths, L.pad, L.pad);
      ctx.textAlign = 'right'; ctx.fillStyle = P.mint;
      ctx.fillText('sync ' + syncPct() + '%', W - L.pad, L.pad);
      if (s.phase === 'play') {
        var inh = s.t % CYCLE < INHALE;
        ctx.textAlign = 'center';
        ctx.font = L.title + 'px ' + F.display; ctx.fillStyle = inh ? P.mint : P.blue;
        ctx.fillText(inh ? 'BREATHE IN' : 'BREATHE OUT', W / 2, L.titleY);
        ctx.font = L.sub + 'px ' + F.body; ctx.fillStyle = P.ink;
        ctx.fillText(inh ? 'hold the screen' : 'let go', W / 2, L.subY);
      }
      ctx.fillStyle = rgba(P.mint, 0.5);
      ctx.fillRect(0, H - 3, W * clamp(s.t / duration, 0, 1), 3);
    }

    function drawEnd() {
      var W = s.W, H = s.H, a = clamp(s.endT / 0.5, 0, 1);
      ctx.fillStyle = rgba(P.bg, 0.55 * a); ctx.fillRect(0, 0, W, H);
      var size = fitSize('NICE AND SLOW', F.display, clamp(W * 0.08, 22, 44), W - s.L.pad * 2);
      ctx.globalAlpha = a; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = size + 'px ' + F.display; ctx.fillStyle = P.amber;
      ctx.fillText('NICE AND SLOW', W / 2, H * 0.5);
      ctx.globalAlpha = 1;
    }

    function draw() {
      drawSky(); drawRibbon(); drawLantern(); drawHud();
      if (s.phase === 'end') drawEnd();
    }

    function tick(ts) {
      if (S !== s) return;
      s.raf = requestAnimationFrame(tick);
      if (document.hidden) { s.last = 0; return; }          // pause while hidden
      var dt = s.last ? Math.min(0.05, (ts - s.last) / 1000) : 0;
      s.last = ts;
      update(dt);
      if (S === s) draw();
    }

    function finish() {
      var result = { score: s.collected * 10, completed: true, breaths: Math.floor(duration / CYCLE + 0.001),
                     sync: clamp(syncPct(), 0, 100), seconds: Math.round(Math.min(s.t, duration)) };
      stop();
      if (typeof opts.onEnd === 'function') opts.onEnd(result);
    }

    if (typeof ResizeObserver === 'function') { s.ro = new ResizeObserver(function () { if (S === s) { fit(); draw(); } }); s.ro.observe(canvas); }
    fit(); draw();
    s.raf = requestAnimationFrame(tick);
  }

  function stop() {
    var s = S; if (!s) return;
    S = null;
    cancelAnimationFrame(s.raf);
    if (s.ro) s.ro.disconnect();
    s.listeners.forEach(function (l) { l[0].removeEventListener(l[1], l[2], l[3]); });
    s.listeners = [];
    if (s.audio) {
      try { s.audio.osc.stop(); s.audio.ac.close(); } catch (e) {}
      s.audio = null;
    }
  }

  window.QuitGames.breath = { start: start, stop: stop };
})();
