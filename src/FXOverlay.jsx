import React, { useEffect, useRef } from "react";

export default function FXOverlay() {
  const canvasRef = useRef(null);
  const overlayRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    if (!canvas || !overlay) return;

    const ctx = canvas.getContext("2d");
    const DPR = Math.max(1, window.devicePixelRatio || 1);

    // ----- 기존 설정값 유지 -----
    const RADIUS = 150;
    const TRAIL_RADIUS = 150;
    const TRAIL_FADE_MS = 19000;
    const FOG_ALPHA = 0.003;
    const CLEAR_STRENGTH = 0.001;
    const PATH_STEP_PX = 8;

    const FADE_GAMMA = 0.55;
    const TRAIL_INNER_FRAC = 0.38;

    const SPEED_NORM = 2.2;
    const SPEED_MAX_SCALE = 0.8;
    const SPEED_ALPHA = 0.2;

    const NOISE_SIZE = 512;
    const NOISE_STRENGTH = 0.95;
    const NOISE_SPEED = 10;
    const NOISE_SCALE = 1.0;

    const IDLE_ENABLED = true;
    const IDLE_BLOBS = 4;
    const IDLE_RADIUS = 2400;
    const IDLE_AMPLITUDE_X = 1100;
    const IDLE_AMPLITUDE_Y = 900;
    const IDLE_FREQ = 0.0009;
    const IDLE_ALPHA = 0.12;
    const IDLE_PULSE_FREQ = 0.0008;

    const SPEC_VIS_ENABLED = true;
    const SPEC_TILE_SIZE = 400;
    const SPEC_DENSITY = 0.01;   // (요청 값)
    const SPEC_VIS_ALPHA = 0.4;
    const SPEC_VIS_SCALE = 1.2;
    const SPEC_VIS_SPEED = 0.0;
    const SPEC_DIR = { x: 1.0, y: 0.7 };

    const REFRACTION_ENABLED = true;
    const REFRACT_OFFSET = 0.9;
    const REFRACT_SPEED = 0.0022;
    const REFRACT_ALPHA_MAIN = 0.9;
    const REFRACT_ALPHA_EDGE = 0.35;

    const MASK_BLEED = Math.max(2, Math.round(2 * DPR));

    // ★ 게이트 마스크 사용 (켜짐)
    const GATE_ENABLED = true;

    // 오프스크린
    const maskCanvas = document.createElement("canvas");
    const maskCtx = maskCanvas.getContext("2d");
    const brushLayer = document.createElement("canvas");
    const brushCtx = brushLayer.getContext("2d");
    const sparkleLayer = document.createElement("canvas");
    const sparkleCtx = sparkleLayer.getContext("2d");

    // ★ 상위 게이트 마스크(스파클을 패치 단위로 게이팅)
    const gateMask = document.createElement("canvas");
    const gateCtx = gateMask.getContext("2d");

    [ctx, maskCtx, brushCtx, sparkleCtx, gateCtx].forEach(c => (c.imageSmoothingEnabled = false));

    // 유틸
    const makeSpecTile = (size = SPEC_TILE_SIZE, density = SPEC_DENSITY) => {
      const tile = document.createElement("canvas");
      tile.width = size;
      tile.height = size;
      const tctx = tile.getContext("2d");
      tctx.clearRect(0, 0, size, size);
      const count = Math.max(4, Math.floor(size * size * density));
      for (let i = 0; i < count; i++) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        const r = 0.6 + Math.random() * 1.8;
        const g = tctx.createRadialGradient(x, y, 0, x, y, r * 3.5);
        g.addColorStop(0.0, "rgba(255,255,255,0.9)");
        g.addColorStop(0.3, "rgba(255,255,255,0.35)");
        g.addColorStop(1.0, "rgba(255,255,255,0)");
        tctx.fillStyle = g;
        tctx.beginPath();
        tctx.arc(x, y, r * 3.5, 0, Math.PI * 2);
        tctx.fill();
      }
      return tile;
    };

    const makeFBmNoise = (size = NOISE_SIZE) => {
      const base = document.createElement("canvas");
      base.width = 128;
      base.height = 128;
      const bctx = base.getContext("2d");
      const img = bctx.createImageData(base.width, base.height);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = Math.random() * 255;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
      bctx.putImageData(img, 0, 0);

      const noise = document.createElement("canvas");
      noise.width = size;
      noise.height = size;
      const nctx = noise.getContext("2d");
      nctx.clearRect(0, 0, size, size);

      const octaves = [
        { scale: 1.0, alpha: 0.55 },
        { scale: 0.5, alpha: 0.28 },
        { scale: 0.25, alpha: 0.17 },
      ];
      octaves.forEach(({ scale, alpha }) => {
        nctx.globalAlpha = alpha;
        const tile = document.createElement("canvas");
        tile.width = Math.max(1, Math.floor(base.width * (1 / scale)));
        tile.height = Math.max(1, Math.floor(base.height * (1 / scale)));
        const tctx = tile.getContext("2d");
        tctx.imageSmoothingEnabled = false;
        tctx.drawImage(base, 0, 0, tile.width, tile.height);
        const pat = nctx.createPattern(tile, "repeat");
        nctx.fillStyle = pat;
        nctx.fillRect(0, 0, size, size);
      });
      nctx.globalAlpha = 1;
      return noise;
    };

    let noiseCanvas = makeFBmNoise(NOISE_SIZE);
    let noisePattern = null;
    let noiseOffsetT = 0;

    let specTile = makeSpecTile(SPEC_TILE_SIZE, SPEC_DENSITY);
    let specPattern = null;

    // ===== 게이트 마스크(랜덤 패치 on/off) 내부 상수 =====
    const GATE_RES_SCALE = 0.45; // 게이트 캔버스 해상도
    const GATE_CELL = 180;       // 화면상 기준 셀 크기(px)
    let gateCols = 0, gateRows = 0;
    let gateCells = []; // {cx, cy, r, val, target, tNext, speed, phase}

    const rand = (a = 1, b = 0) => b + (a - b) * Math.random();

    const initGate = (W, H) => {
      if (!GATE_ENABLED) return;

      gateMask.width = Math.floor(W * DPR * GATE_RES_SCALE);
      gateMask.height = Math.floor(H * DPR * GATE_RES_SCALE);

      gateCols = Math.max(6, Math.round(W / GATE_CELL));
      gateRows = Math.max(4, Math.round(H / GATE_CELL));
      gateCells = [];

      const cw = gateMask.width / gateCols;
      const ch = gateMask.height / gateRows;

      for (let j = 0; j < gateRows; j++) {
        for (let i = 0; i < gateCols; i++) {
          const cx = (i + 0.5) * cw;
          const cy = (j + 0.5) * ch;
          const r = Math.min(cw, ch) * 0.75;
          gateCells.push({
            cx, cy, r,
            val: Math.random(),
            target: Math.random() < 0.5 ? 0 : 1,
            // ★ 더 자주 깜빡이도록 설정
            tNext: performance.now() + rand(2000, 1500),
            speed: rand(0.06, 0.02),
            phase: Math.random() * Math.PI * 2,
          });
        }
      }
    };

    const updateGate = (t) => {
      if (!GATE_ENABLED) return;
      const now = t;
      for (let i = 0; i < gateCells.length; i++) {
        const c = gateCells[i];
        if (now > c.tNext) {
          c.target = c.target > 0.5 ? 0 : 1;
          c.tNext = now + rand(800, 2200); // 빈도 증가
        }
        const breath = 0.15 * Math.sin(t * 0.0005 + c.phase);
        const aim = Math.min(1, Math.max(0, c.target + breath));
        c.val += (aim - c.val) * c.speed;
      }
    };

    const drawGate = () => {
      if (!GATE_ENABLED) return;
      gateCtx.setTransform(1, 0, 0, 1, 0, 0);
      gateCtx.globalCompositeOperation = "source-over";
      gateCtx.clearRect(0, 0, gateMask.width, gateMask.height);

      for (let i = 0; i < gateCells.length; i++) {
        const c = gateCells[i];
        if (c.val < 0.02) continue;
        const inner = c.r * 0.45;
        const g = gateCtx.createRadialGradient(c.cx, c.cy, inner, c.cx, c.cy, c.r);
        g.addColorStop(0, `rgba(255,255,255,${0.9 * c.val})`);
        g.addColorStop(1, "rgba(255,255,255,0)");
        gateCtx.fillStyle = g;
        gateCtx.beginPath();
        gateCtx.arc(c.cx, c.cy, c.r, 0, Math.PI * 2);
        gateCtx.fill();
      }
      // 경계 살짝 블러
      gateCtx.filter = "blur(1px)";
      gateCtx.drawImage(gateMask, 0, 0);
      gateCtx.filter = "none";
    };

    const resize = () => {
      const w = overlay.clientWidth || window.innerWidth;
      const h = overlay.clientHeight || window.innerHeight;

      canvas.width = Math.floor(w * DPR);
      canvas.height = Math.floor(h * DPR);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

      maskCanvas.width = Math.floor(w * DPR);
      maskCanvas.height = Math.floor(h * DPR);
      brushLayer.width = Math.floor(w * DPR);
      brushLayer.height = Math.floor(h * DPR);
      sparkleLayer.width = Math.floor(w * DPR);
      sparkleLayer.height = Math.floor(h * DPR);

      gateMask.width = Math.floor(w * DPR * GATE_RES_SCALE);
      gateMask.height = Math.floor(h * DPR * GATE_RES_SCALE);

      overlay.style.webkitMaskSize = "100% 100%";
      overlay.style.maskSize = "100% 100%";
      overlay.style.webkitMaskRepeat = "no-repeat";
      overlay.style.maskRepeat = "no-repeat";
      overlay.style.webkitMaskPosition = "left top";
      overlay.style.maskPosition = "left top";

      noisePattern = brushCtx.createPattern(noiseCanvas, "repeat");
      specPattern = sparkleCtx.createPattern(specTile, "repeat");

      initGate(w, h);
    };
    resize();
    window.addEventListener("resize", resize);

    const toLocal = (clientX, clientY) => {
      const rect = overlay.getBoundingClientRect();
      return { x: clientX - rect.left, y: clientY - rect.top };
    };

    let mouseX = (overlay.clientWidth || window.innerWidth) / 2;
    let mouseY = (overlay.clientHeight || window.innerHeight) / 2;
    let prevX = mouseX, prevY = mouseY;

    const trails = [];
    let lastSampleT = 0;
    let speedEMA = 0;

    const addTrail = (x, y, t, s) => {
      trails.push({ x, y, t, s });
      const cutoff = t - TRAIL_FADE_MS - 200;
      while (trails.length && trails[0].t < cutoff) trails.shift();
    };

    const onMove = (e) => {
      const cx = e.touches?.[0]?.clientX ?? e.clientX;
      const cy = e.touches?.[0]?.clientY ?? e.clientY;
      if (cx == null || cy == null) return;
      const { x, y } = toLocal(cx, cy);
      mouseX = x; mouseY = y;
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    let rafId = 0;
    const draw = (t) => {
      const W = canvas.width / DPR;
      const H = canvas.height / DPR;

      // 1) 포그
      ctx.globalCompositeOperation = "source-over";
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = `rgba(255,255,255,${FOG_ALPHA})`;
      ctx.fillRect(0, 0, W, H);

      // 2) 경로/속도
      const dx = mouseX - prevX, dy = mouseY - prevY;
      const dist = Math.hypot(dx, dy);
      const dt = Math.max(1, (lastSampleT ? (t - lastSampleT) : 16));
      const instSpeed = dist / dt;
      speedEMA = speedEMA * (1 - SPEED_ALPHA) + instSpeed * SPEED_ALPHA;

      if (dist > PATH_STEP_PX) {
        const steps = Math.ceil(dist / PATH_STEP_PX);
        for (let s = 1; s <= steps; s++) {
          const ix = prevX + (dx * s) / steps;
          const iy = prevY + (dy * s) / steps;
          addTrail(ix, iy, t, speedEMA);
        }
        lastSampleT = t;
      }
      prevX = mouseX; prevY = mouseY;

      // 3) 브러시(커서/아이들/잔상)
      brushCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
      brushCtx.globalCompositeOperation = "source-over";
      brushCtx.clearRect(0, 0, W, H);

      if (IDLE_ENABLED) {
        for (let k = 0; k < IDLE_BLOBS; k++) {
          const phase = k * Math.PI * 0.66;
          const cx = W * 0.5 + Math.sin(t * IDLE_FREQ * (1.0 + k * 0.15) + phase) * IDLE_AMPLITUDE_X;
          const cy = H * 0.5 + Math.cos(t * IDLE_FREQ * 1.25 * (1.0 + k * 0.12) + phase * 0.7) * IDLE_AMPLITUDE_Y;
          const rPulse = 1.0 + 0.06 * Math.sin(t * IDLE_PULSE_FREQ + phase * 0.9);
          const r = IDLE_RADIUS * rPulse;
          const aPulse = 0.5 + 0.5 * Math.sin(t * IDLE_PULSE_FREQ * 0.9 + phase);
          const a = IDLE_ALPHA * aPulse;

          const grad = brushCtx.createRadialGradient(cx, cy, r * 0.35, cx, cy, r);
          grad.addColorStop(0, `rgba(255,255,255,${a})`);
          grad.addColorStop(1, "rgba(255,255,255,0)");
          brushCtx.fillStyle = grad;
          brushCtx.beginPath();
          brushCtx.arc(cx, cy, r, 0, Math.PI * 2);
          brushCtx.fill();
        }
      }

      // 커서
      {
        const grad = brushCtx.createRadialGradient(
          mouseX, mouseY, RADIUS * 0.3,
          mouseX, mouseY, RADIUS
        );
        grad.addColorStop(0, "rgba(255,255,255,1)");
        grad.addColorStop(1, "rgba(255,255,255,0)");
        brushCtx.fillStyle = grad;
        brushCtx.beginPath();
        brushCtx.arc(mouseX, mouseY, RADIUS, 0, Math.PI * 2);
        brushCtx.fill();
      }

      // 잔상
      const now = t;
      for (let i = 0; i < trails.length; i++) {
        const age = now - trails[i].t;
        if (age > TRAIL_FADE_MS) continue;
        const kLinear = 1 - age / TRAIL_FADE_MS;
        const k = Math.pow(Math.max(0, kLinear), FADE_GAMMA);
        const v = Math.min(1, (trails[i].s || 0) / SPEED_NORM);
        const speedScale = 1 + SPEED_MAX_SCALE * v;
        const r = TRAIL_RADIUS * speedScale;

        const g = brushCtx.createRadialGradient(
          trails[i].x, trails[i].y, r * TRAIL_INNER_FRAC,
          trails[i].x, trails[i].y, r
        );
        const opacityBoost = 0.6 + 0.6 * v;
        g.addColorStop(0, `rgba(255,255,255,${0.85 * k * opacityBoost})`);
        g.addColorStop(1, "rgba(255,255,255,0)");
        brushCtx.fillStyle = g;
        brushCtx.beginPath();
        brushCtx.arc(trails[i].x, trails[i].y, r, 0, Math.PI * 2);
        brushCtx.fill();
      }

      // 노이즈 질감
      noiseOffsetT += NOISE_SPEED;
      const nx = (noiseCanvas.width * NOISE_SCALE) || noiseCanvas.width;
      const ny = (noiseCanvas.height * NOISE_SCALE) || noiseCanvas.height;
      const offX = (noiseCanvas.width * noiseOffsetT) % nx;
      const offY = (noiseCanvas.height * noiseOffsetT * 0.8) % ny;

      brushCtx.save();
      brushCtx.globalCompositeOperation = "destination-in";
      brushCtx.globalAlpha = NOISE_STRENGTH;
      brushCtx.translate(-offX, -offY);
      brushCtx.scale(NOISE_SCALE, NOISE_SCALE);
      brushCtx.fillStyle = noisePattern || brushCtx.createPattern(noiseCanvas, "repeat");
      if (!noisePattern) noisePattern = brushCtx.fillStyle;
      brushCtx.fillRect(offX, offY, W / NOISE_SCALE + nx, H / NOISE_SCALE + ny);
      brushCtx.restore();

      // 4) 메인 캔버스 지우기
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = "destination-out";
      if (REFRACTION_ENABLED) {
        const phase = t * REFRACT_SPEED;
        const ox = Math.round(Math.sin(phase) * REFRACT_OFFSET * DPR);
        const oy = Math.round(Math.cos(phase * 1.3) * REFRACT_OFFSET * DPR);
        ctx.globalAlpha = REFRACT_ALPHA_MAIN;
        ctx.drawImage(brushLayer, 0, 0);
        ctx.globalAlpha = REFRACT_ALPHA_EDGE;
        ctx.drawImage(brushLayer,  ox,  oy);
        ctx.drawImage(brushLayer, -ox, -oy);
      } else {
        ctx.globalAlpha = 1;
        ctx.drawImage(brushLayer, 0, 0);
      }
      ctx.restore();

      // ★★★ 게이트 마스크 업데이트/그리기
      if (GATE_ENABLED) {
        updateGate(t);
        drawGate();
      }

      // 4.5) 스파클 + (선택) 게이트 마스크 적용
      if (SPEC_VIS_ENABLED && specPattern) {
        const moveX = (t * SPEC_VIS_SPEED * SPEC_DIR.x) % 1;
        const moveY = (t * SPEC_VIS_SPEED * SPEC_DIR.y) % 1;

        sparkleCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
        sparkleCtx.globalCompositeOperation = "source-over";
        sparkleCtx.clearRect(0, 0, W, H);

        sparkleCtx.save();
        sparkleCtx.globalAlpha = SPEC_VIS_ALPHA;
        sparkleCtx.translate(-moveX * SPEC_TILE_SIZE, -moveY * SPEC_TILE_SIZE);
        sparkleCtx.scale(SPEC_VIS_SCALE, SPEC_VIS_SCALE);
        sparkleCtx.fillStyle = specPattern;
        sparkleCtx.fillRect(
          moveX * SPEC_TILE_SIZE,
          moveY * SPEC_TILE_SIZE,
          (W / SPEC_VIS_SCALE) + SPEC_TILE_SIZE * 2,
          (H / SPEC_VIS_SCALE) + SPEC_TILE_SIZE * 2
        );
        sparkleCtx.restore();

        // 게이트 마스크로 패치 단위 페이드 인/아웃
        if (GATE_ENABLED) {
          sparkleCtx.save();
          sparkleCtx.setTransform(1, 0, 0, 1, 0, 0);
          sparkleCtx.globalCompositeOperation = "destination-in";
          sparkleCtx.drawImage(
            gateMask,
            0, 0, gateMask.width, gateMask.height,
            0, 0, sparkleLayer.width, sparkleLayer.height
          );
          sparkleCtx.restore();
        }

        // 호버 지우기
        sparkleCtx.globalCompositeOperation = "destination-out";
        sparkleCtx.setTransform(1, 0, 0, 1, 0, 0);
        sparkleCtx.drawImage(brushLayer, 0, 0);
      }

      // 5) 마스크 갱신
      maskCtx.setTransform(1, 0, 0, 1, 0, 0);
      maskCtx.globalCompositeOperation = "source-over";
      maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
      maskCtx.fillStyle = "#000";
      maskCtx.fillRect(
        -MASK_BLEED, -MASK_BLEED,
        maskCanvas.width + MASK_BLEED * 2,
        maskCanvas.height + MASK_BLEED * 2
      );
      maskCtx.globalCompositeOperation = "destination-out";
      maskCtx.drawImage(brushLayer, 0, 0);

      if (SPEC_VIS_ENABLED) {
        sparkleCtx.save();
        sparkleCtx.globalCompositeOperation = "destination-in";
        sparkleCtx.drawImage(maskCanvas, 0, 0);
        sparkleCtx.restore();

        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = 1;
        ctx.drawImage(sparkleLayer, 0, 0);
        ctx.restore();
      }

      const url = maskCanvas.toDataURL("image/png");
      overlay.style.webkitMaskImage = `url(${url})`;
      overlay.style.maskImage = `url(${url})`;

      rafId = requestAnimationFrame(draw);
    };

    rafId = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
    };
  }, []);

  return (
    <div className="fx-overlay" ref={overlayRef} aria-hidden="true">
      <canvas className="fx-fog-canvas" ref={canvasRef} />
    </div>
  );
}
