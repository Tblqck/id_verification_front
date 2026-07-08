(function () {
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var accent = '#a78bfa';
  var accent2 = '#7c5dff';
  try {
    var rootCs = getComputedStyle(document.documentElement);
    accent = (rootCs.getPropertyValue('--accent') || accent).trim() || accent;
    accent2 = (rootCs.getPropertyValue('--accent-2') || accent2).trim() || accent2;
  } catch (e) {}

  function hexToRgb(hex) {
    var m = hex.replace('#', '');
    if (m.length === 3) m = m.split('').map(function (c) { return c + c; }).join('');
    var num = parseInt(m, 16);
    if (isNaN(num)) return { r: 167, g: 139, b: 250 };
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
  }

  var A = hexToRgb(accent);
  var B = hexToRgb(accent2);
  function rgba(c, a) { return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + a + ')'; }

  var DPR = Math.min(window.devicePixelRatio || 1, 2);

  var VARIANTS = ['rings', 'network', 'drift'];

  function makeScene(section, variant, seed) {
    var canvas = document.createElement('canvas');
    canvas.className = 'bgfx-layer';
    canvas.setAttribute('aria-hidden', 'true');
    section.insertBefore(canvas, section.firstChild);
    var ctx = canvas.getContext('2d');

    var rand = (function (s) {
      return function () { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    })(seed);

    var scene = { canvas: canvas, ctx: ctx, section: section, variant: variant, w: 0, h: 0, rand: rand };

    if (variant === 'rings') {
      scene.originX = 0.78 + rand() * 0.12;
      scene.originY = 0.35 + rand() * 0.2;
      scene.rings = [0, 1, 2, 3].map(function (i) {
        return {
          r: 55 + i * 42 + rand() * 10,
          speed: (rand() > 0.5 ? 1 : -1) * (0.02 + rand() * 0.05),
          gap: 0.3 + rand() * 0.35,
          gapAt: rand(),
          width: 0.8 + rand() * 0.7
        };
      });
      scene.nodes = Array.from({ length: 5 }).map(function (_, i) {
        return {
          angle: (Math.PI * 2 * i) / 5 + rand(),
          radius: 70 + rand() * 150,
          speed: (rand() > 0.5 ? 1 : -1) * (0.04 + rand() * 0.06),
          pulse: rand() * Math.PI * 2
        };
      });
    } else if (variant === 'network') {
      scene.nodes = Array.from({ length: 9 }).map(function () {
        return {
          x: rand(),
          y: rand(),
          vx: (rand() - 0.5) * 0.02,
          vy: (rand() - 0.5) * 0.02
        };
      });
      scene.linkDist = 0.26;
    } else if (variant === 'drift') {
      scene.lines = Array.from({ length: 10 }).map(function (_, i) {
        return { offset: rand(), speed: 0.01 + rand() * 0.02 };
      });
      scene.dots = Array.from({ length: 6 }).map(function () {
        return { x: rand(), y: rand(), vy: 0.01 + rand() * 0.015, pulse: rand() * Math.PI * 2 };
      });
    }

    return scene;
  }

  function resizeScene(scene) {
    var r = scene.section.getBoundingClientRect();
    scene.w = r.width;
    scene.h = r.height;
    scene.canvas.width = Math.max(1, r.width * DPR);
    scene.canvas.height = Math.max(1, r.height * DPR);
    scene.ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  function drawRings(scene, t) {
    var ctx = scene.ctx, w = scene.w, h = scene.h;
    var scale = Math.min(w, h) / 700;
    var ox = w * scene.originX, oy = h * scene.originY;

    ctx.save();
    ctx.translate(ox, oy);
    scene.rings.forEach(function (ring) {
      var r = ring.r * scale;
      var start = t * ring.speed + ring.gapAt * Math.PI * 2;
      var end = start + (1 - ring.gap) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(0, 0, r, start, end);
      ctx.strokeStyle = rgba(A, 0.22);
      ctx.lineWidth = ring.width;
      ctx.stroke();
    });
    ctx.restore();

    var pulse = (4 + Math.sin(t * 1.3) * 1.4) * scale;
    ctx.beginPath();
    ctx.arc(ox, oy, pulse, 0, Math.PI * 2);
    ctx.fillStyle = rgba(A, 0.85);
    ctx.fill();

    scene.nodes.forEach(function (n) {
      n.angle += n.speed * 0.016;
      var nr = n.radius * scale;
      var nx = ox + Math.cos(n.angle) * nr;
      var ny = oy + Math.sin(n.angle) * nr * 0.72;
      var alpha = 0.12 + (Math.sin(n.pulse + t * 0.8) + 1) * 0.05;

      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(nx, ny);
      ctx.strokeStyle = rgba(B, alpha);
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(nx, ny, 2 * scale, 0, Math.PI * 2);
      ctx.fillStyle = rgba(B, 0.7);
      ctx.fill();
    });
  }

  function drawNetwork(scene, t) {
    var ctx = scene.ctx, w = scene.w, h = scene.h;
    scene.nodes.forEach(function (n) {
      n.x += n.vx * 0.016;
      n.y += n.vy * 0.016;
      if (n.x < 0 || n.x > 1) n.vx *= -1;
      if (n.y < 0 || n.y > 1) n.vy *= -1;
      n.x = Math.min(1, Math.max(0, n.x));
      n.y = Math.min(1, Math.max(0, n.y));
    });

    for (var i = 0; i < scene.nodes.length; i++) {
      for (var j = i + 1; j < scene.nodes.length; j++) {
        var na = scene.nodes[i], nb = scene.nodes[j];
        var dx = na.x - nb.x, dy = na.y - nb.y;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < scene.linkDist) {
          var alpha = (1 - dist / scene.linkDist) * 0.18;
          ctx.beginPath();
          ctx.moveTo(na.x * w, na.y * h);
          ctx.lineTo(nb.x * w, nb.y * h);
          ctx.strokeStyle = rgba(B, alpha);
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }
    scene.nodes.forEach(function (n) {
      ctx.beginPath();
      ctx.arc(n.x * w, n.y * h, 2.4, 0, Math.PI * 2);
      ctx.fillStyle = rgba(A, 0.55);
      ctx.fill();
    });
  }

  function drawDrift(scene, t) {
    var ctx = scene.ctx, w = scene.w, h = scene.h;
    var diag = w + h;

    scene.lines.forEach(function (line) {
      var off = ((line.offset + t * line.speed) % 1) * diag;
      ctx.beginPath();
      ctx.moveTo(off - h, 0);
      ctx.lineTo(off, h);
      ctx.strokeStyle = rgba(A, 0.05);
      ctx.lineWidth = 1;
      ctx.stroke();
    });

    scene.dots.forEach(function (d) {
      var y = ((d.y + t * d.vy) % 1.15) - 0.075;
      var alpha = 0.15 + (Math.sin(d.pulse + t) + 1) * 0.08;
      ctx.beginPath();
      ctx.arc(d.x * w, y * h, 2, 0, Math.PI * 2);
      ctx.fillStyle = rgba(B, alpha);
      ctx.fill();
    });
  }

  var DRAW = { rings: drawRings, network: drawNetwork, drift: drawDrift };

  function init() {
    var sections = document.querySelectorAll('.page-hero, section.block');
    var scenes = [];
    sections.forEach(function (section, i) {
      var variant = VARIANTS[i % VARIANTS.length];
      var scene = makeScene(section, variant, i * 977 + 13);
      resizeScene(scene);
      scenes.push(scene);
    });

    window.addEventListener('resize', function () {
      DPR = Math.min(window.devicePixelRatio || 1, 2);
      scenes.forEach(resizeScene);
    });

    if (reduceMotion) {
      scenes.forEach(function (scene) {
        scene.ctx.clearRect(0, 0, scene.w, scene.h);
        DRAW[scene.variant](scene, 0);
      });
      return;
    }

    var t = 0;
    function frame() {
      t += 0.016;
      scenes.forEach(function (scene) {
        scene.ctx.clearRect(0, 0, scene.w, scene.h);
        DRAW[scene.variant](scene, t);
      });
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
