import React, { useEffect, useRef, useState } from "react";

const FRAMES_PER_SECOND = 24;
const INERTIA_DECAY_MS = 600;
const WHEEL_RATE_FPS = 24;
const WHEEL_GRACE_MS = 120;

const TOTAL_FRAMES = 1132;
const FRAME_PATH = (i) => `/frames/7_${i.toString().padStart(5, "0")}.jpg`;
const PRELOAD_CONCURRENCY = 1000;

// 팬 강도(px). 이미지가 컨테이너보다 커야 자연스러움
const PAN_RANGE_X = 40;  // 좌우 최대 이동량
const PAN_RANGE_Y = 24;  // 상하 최대 이동량
const PAN_LERP = 0.12;   // 부드러운 추종 정도(0~1)

const ImageSequence = () => {
  const [images, setImages] = useState([]);
  const [frame, setFrame] = useState(0);
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false);

  const wrapRef = useRef(null);

  const animRef = useRef({
    rafId: null,
    running: false,
    lastTs: 0,
    floatFrame: 0,
    targetFrame: 0,
    direction: 0,
    lastInputTime: 0,
    wheelActiveUntil: 0,

    // 팬 상태
    targetPanX: 0,
    targetPanY: 0,
    panX: 0,
    panY: 0,
    hover: false,
  });

  // 프리로드
  useEffect(() => {
    let cancelled = false;

    const preloadOne = (index) =>
      new Promise((resolve) => {
        const url = FRAME_PATH(index);
        const img = new Image();
        img.decoding = "async";
        try { img.fetchPriority = "low"; } catch (_) {}
        const done = (ok) => resolve({ ok, index, url });
        img.onload = async () => {
          try { if (img.decode) await img.decode(); } catch (_) {}
          done(true);
        };
        img.onerror = () => done(false);
        img.src = url;
      });

    const preloadAll = async () => {
      const results = new Array(TOTAL_FRAMES);
      let completed = 0;
      const indices = Array.from({ length: TOTAL_FRAMES }, (_, i) => i);

      const worker = async () => {
        while (indices.length) {
          const idx = indices.shift();
          const res = await preloadOne(idx);
          results[idx] = res.ok ? res.url : null;
          completed++;
          if (!cancelled) setProgress(Math.round((completed / TOTAL_FRAMES) * 100));
        }
      };

      await Promise.all(Array.from({ length: PRELOAD_CONCURRENCY }, worker));
      if (cancelled) return;

      const valid = results.filter(Boolean);
      if (valid.length === 0) {
        console.error("No frames loaded.");
        return;
      }
      setImages(valid);
      const s = animRef.current;
      s.floatFrame = 0;
      s.targetFrame = 0;
      setReady(true);
    };

    preloadAll();
    return () => { cancelled = true; };
  }, []);

  // 루프 + 팬
  useEffect(() => {
    if (!ready || images.length === 0) return;
    const step = (ts) => {
      const s = animRef.current;
      if (!s.running) return;

      const now = ts;
      const dt = s.lastTs ? (ts - s.lastTs) / 1000 : 0;
      s.lastTs = ts;

      // 휠 등속
      const wheelActive = now <= s.wheelActiveUntil && s.direction !== 0;
      if (wheelActive && dt > 0) {
        s.targetFrame += s.direction * (WHEEL_RATE_FPS * dt);
      }
      s.targetFrame = Math.max(0, Math.min(s.targetFrame, images.length - 1));

      // 프레임 추종
      const atTarget = Math.abs(s.targetFrame - s.floatFrame) < 0.001;
      if (!wheelActive && INERTIA_DECAY_MS != null) {
        const idle = ts - s.lastInputTime;
        if (idle > INERTIA_DECAY_MS && atTarget) {
          s.direction = 0;
          s.running = false;
          s.rafId = null;
          return;
        }
      }
      if (!atTarget) {
        const maxStep = FRAMES_PER_SECOND * dt;
        const diff = s.targetFrame - s.floatFrame;
        const move = Math.sign(diff) * Math.min(Math.abs(diff), maxStep);
        s.floatFrame += move;
        s.floatFrame = Math.max(0, Math.min(s.floatFrame, images.length - 1));
        setFrame(Math.round(s.floatFrame));
      }

      // 팬: 목표값으로 스무스 추종
      s.panX += (s.targetPanX - s.panX) * PAN_LERP;
      s.panY += (s.targetPanY - s.panY) * PAN_LERP;

      // 이미지 스타일 적용
      const el = wrapRef.current?.firstChild;
      if (el) {
        el.style.transform = `translate3d(${s.panX.toFixed(2)}px, ${s.panY.toFixed(2)}px, 0)`;
      }

      s.rafId = requestAnimationFrame(step);
    };

    const start = () => {
      const s = animRef.current;
      if (!s.running) {
        s.running = true;
        s.lastTs = 0;
        s.rafId = requestAnimationFrame(step);
      }
    };

    // 입력
    const onWheel = (e) => {
      e.preventDefault();
      const dir = e.deltaY > 0 ? 1 : e.deltaY < 0 ? -1 : 0;
      if (!dir) return;
      const s = animRef.current;
      s.direction = dir;
      const now = performance.now();
      s.lastInputTime = now;
      s.wheelActiveUntil = now + WHEEL_GRACE_MS;
      start();
    };

    // 마우스 호버 팬
    const onMouseMove = (e) => {
      const s = animRef.current;
      if (!s.hover) return;
      const rect = wrapRef.current.getBoundingClientRect();
      const nx = (e.clientX - rect.left) / rect.width;  // 0~1
      const ny = (e.clientY - rect.top) / rect.height; // 0~1
      // 중앙 기준으로 -PAN_RANGE ~ +PAN_RANGE
      s.targetPanX = (nx - 0.5) * 2 * PAN_RANGE_X;
      s.targetPanY = (ny - 0.5) * 2 * PAN_RANGE_Y;
    };
    const onMouseEnter = () => { animRef.current.hover = true; };
    const onMouseLeave = () => {
      const s = animRef.current;
      s.hover = false;
      s.targetPanX = 0;
      s.targetPanY = 0;
    };

    window.addEventListener("wheel", onWheel, { passive: false });
    const wrap = wrapRef.current;
    wrap.addEventListener("mousemove", onMouseMove);
    wrap.addEventListener("mouseenter", onMouseEnter);
    wrap.addEventListener("mouseleave", onMouseLeave);

    // 최초 시작
    start();

    return () => {
      window.removeEventListener("wheel", onWheel, { passive: false });
      if (wrap) {
        wrap.removeEventListener("mousemove", onMouseMove);
        wrap.removeEventListener("mouseenter", onMouseEnter);
        wrap.removeEventListener("mouseleave", onMouseLeave);
      }
      const s = animRef.current;
      if (s.rafId) cancelAnimationFrame(s.rafId);
      s.rafId = null;
      s.running = false;
    };
  }, [ready, images]);

  if (!ready) {
    return (
      <div
        style={{
          position: "fixed", inset: 0, background: "#000",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "#fff", flexDirection: "column", gap: "12px"
        }}
      >
        <div style={{ fontSize: 18 }}>Preparing frames…</div>
        <div style={{ width: 320, height: 8, background: "#222", borderRadius: 999 }}>
          <div
            style={{
              width: `${progress}%`, height: "100%",
              background: "#5cf", borderRadius: 999, transition: "width 120ms linear"
            }}
          />
        </div>
        <div style={{ fontVariantNumeric: "tabular-nums", opacity: 0.8 }}>{progress}%</div>
      </div>
    );
  }

  return (
    <div
      ref={wrapRef}
      style={{
        position: "fixed",
        top: 0,
        left: "50%",
        transform: "translateX(-50%)",
        width: "1920px",
        height: "100vh",
        backgroundColor: "#000",
        overflow: "hidden",
        cursor: "grab",
      }}
    >
      <img
        src={images[frame]}
        alt="Frame"
        style={{
          width: "calc(100% + 80px)", // 좌우 패닝 여유
          height: "calc(100% + 48px)", // 상하 패닝 여유
          objectFit: "cover",
          display: "block",
          userSelect: "none",
          pointerEvents: "none",
          willChange: "transform",
          transform: "translate3d(0,0,0)",
        }}
        draggable={false}
        decoding="sync"
      />
    </div>
  );
};

export default ImageSequence;
