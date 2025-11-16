import React, { useState, useEffect, useRef } from 'react';
import FXOverlay from './FXOverlay';
import './index.css';

// --- 설정 (유지) ---
// ✅ 시퀀스 총 장수: 1132장으로 고정
const TOTAL_FRAMES = 1132;
const getImagePath = (frame) => `/frames/(${frame + 1}).jpg`;
// ✅ 스크롤 끝 → 페이드아웃 후 이동할 URL
const REDIRECT_URL = 'http://localhost:5173/';
// --- 

export default function App() {
  const [currentFrame, setCurrentFrame] = useState(0);
  const [effectsOn, setEffectsOn] = useState(true); // ✅ 효과 켜짐/꺼짐
  const [isFading, setIsFading] = useState(false);  // ✅ 페이드아웃 상태
  const [scrollPos, setScrollPos] = useState(0);    // (옵션) 디버그용
  const scrollContainerRef = useRef(null);
  const sceneRef = useRef(null);
  const hasRedirected = useRef(false);              // ✅ 중복 이동 방지

  // 스크롤 → 프레임 (+ 끝에서 페이드아웃 & 이동)
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    let ticking = false;

    const updateFrameFromScroll = () => {
      const maxScrollTop = container.scrollHeight - container.clientHeight;
      const scrollTop = container.scrollTop;
      const scrollFraction = maxScrollTop > 0 ? (scrollTop / maxScrollTop) : 0;
      const frameIndex = Math.min(TOTAL_FRAMES - 1, Math.floor(scrollFraction * TOTAL_FRAMES));

      setCurrentFrame((prev) => (prev !== frameIndex ? frameIndex : prev));
      setScrollPos(scrollTop.toFixed(0));

      // ✅ 스크롤 바닥 근처 (여유 300px) → 페이드아웃 + 이동
      const distanceFromBottom = maxScrollTop - scrollTop;
      if (distanceFromBottom < 300 && !hasRedirected.current) {
        hasRedirected.current = true;
        setIsFading(true); // 페이드 시작
        // 1.5초 뒤 이동
        setTimeout(() => {
          window.location.href = REDIRECT_URL;
        }, 1500);
      }
    };

    const handleScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => { updateFrameFromScroll(); ticking = false; });
    };

    // 최초 1회 계산 + 리스너 등록
    updateFrameFromScroll();
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  // 프리로드 (효과가 켜져 있을 때만)
  useEffect(() => {
    if (!effectsOn) return;
    const preloadCount = 5;
    for (let i = 1; i <= preloadCount; i++) {
      const next = currentFrame + i;
      if (next < TOTAL_FRAMES) {
        const img = new Image();
        img.src = getImagePath(next);
      }
    }
  }, [currentFrame, effectsOn]);

  // ✅ 시퀀스 종료 감지 → 효과 끄기(그리고 위로 다시 스크롤하면 자동 재활성)
  useEffect(() => {
    const END_BUFFER = 0; 
    const atEnd = currentFrame >= (TOTAL_FRAMES - 1 - END_BUFFER);
    setEffectsOn(!atEnd);
  }, [currentFrame]);

  // ✅ 카메라 팬(반전) + 역제곱 커브 + 마우스 멈추면 중앙 복귀
  useEffect(() => {
    if (!effectsOn) return;

    const CAM_W = 2100, CAM_H = 1200;
    const SCENE_W = 1920, SCENE_H = 1080;
    const MAX_X = CAM_W - SCENE_W;
    const MAX_Y = CAM_H - SCENE_H;

    const PAN_STRENGTH = 0.70;
    const LERP_ALPHA   = 0.05;
    const IDLE_DELAY_MS = 1500;

    const baseX = (CAM_W - SCENE_W) / 2;
    const baseY = (CAM_H - SCENE_H) / 2;

    let targetX = 0, targetY = 0;
    let curX = 0, curY = 0;

    let lastMoveT = performance.now();
    let lastTickT = performance.now();

    const invSqCurve = (() => {
      const k = 0.75;
      const norm = 1 - 1 / (1 + (1 / k) ** 2);
      return (v) => {
        const a = Math.max(-1, Math.min(1, v));
        const s = Math.sign(a);
        const x = Math.abs(a);
        const y = (1 - 1 / (1 + (x / k) ** 2)) / norm;
        return s * y;
      };
    })();

    if (sceneRef.current) {
      sceneRef.current.style.transform = `translate3d(${baseX}px, ${baseY}px, 0)`;
    }

    const onMove = (e) => {
      const w = window.innerWidth, h = window.innerHeight;
      const cx = e.clientX ?? (e.touches && e.touches[0]?.clientX) ?? w / 2;
      const cy = e.clientY ?? (e.touches && e.touches[0]?.clientY) ?? h / 2;

      const nxRaw = ((cx / w) - 0.5) * 2;
      const nyRaw = ((cy / h) - 0.5) * 2;

      const nx = invSqCurve(nxRaw);
      const ny = invSqCurve(nyRaw);

      // 반전된 카메라 이동
      targetX = (MAX_X / 2) * (-nx) * PAN_STRENGTH;
      targetY = (MAX_Y / 2) * (-ny) * PAN_STRENGTH;

      lastMoveT = performance.now();
    };

    const onLeave = () => {
      targetX = 0; targetY = 0;
      lastMoveT = -Infinity;
    };

    let raf = 0;
    const tick = (now = performance.now()) => {
      const dt = Math.min(50, now - lastTickT);
      lastTickT = now;
      const frames = dt / (1000 / 60);
      const alphaBase = 1 - Math.pow(1 - LERP_ALPHA, Math.max(1, frames));

      // 마우스/터치 멈춤 → 중앙 복귀
      if (now - lastMoveT > IDLE_DELAY_MS) {
        targetX = 0; targetY = 0;
      }

      const errX = Math.abs(targetX - curX) / (MAX_X / 2);
      const errY = Math.abs(targetY - curY) / (MAX_Y / 2);
      const err = Math.min(1, Math.max(errX, errY));

      const k2 = 0.75;
      const norm2 = 1 - 1 / (1 + (1 / k2) ** 2);
      const invSq01 = (x) => (1 - 1 / (1 + (x / k2) ** 2)) / norm2;

      const w = 0.6 + 0.8 * invSq01(err);
      const alpha = Math.min(0.95, alphaBase * w);

      curX += (targetX - curX) * alpha;
      curY += (targetY - curY) * alpha;

      if (sceneRef.current) {
        sceneRef.current.style.transform =
          `translate3d(${baseX + curX}px, ${baseY + curY}px, 0)`;
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('mouseout', onLeave, { passive: true });
    window.addEventListener('blur', onLeave, { passive: true });

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('mouseout', onLeave);
      window.removeEventListener('blur', onLeave);
    };
  }, [effectsOn]);

  return (
    <>
      {/* 1920 고정 폭 컨텐츠: 스크롤/프레임 계산용 */}
      <div className="page-1920">
        <div ref={scrollContainerRef} className="scroll-container">
          <div className="scroll-content">
            {/* 이 이미지는 프레임 계산용(보이지 않음) */}
            <img
              src={getImagePath(currentFrame)}
              alt={`Frame ${currentFrame + 1}`}
              className="sticky-image"
              aria-hidden="true"
              style={{ opacity: 0, pointerEvents: 'none' }}
            />
            <div style={{ height: '300vh' }} />
          </div>
        </div>
      </div>

      {/* Camera Space */}
      <div
        className="camera-space"
        aria-hidden="true"
        style={{
          width: '2100px',
          height: '1200px',
          visibility: effectsOn ? 'visible' : 'hidden',
          opacity: effectsOn ? 1 : 0,
          transition: 'opacity 200ms linear',
        }}
      >
        <div ref={sceneRef} className="camera-scene">
          <img src={getImagePath(currentFrame)} alt="Scene" />
        </div>
      </div>

      {/* FX 오버레이 */}
      {effectsOn ? <FXOverlay /> : null}

      {/* ▼▼ 일반 웹 페이지 ▼▼ 
          ⛔️ 요청에 따라 "사이트 시작" 섹션은 제거하고
          스크롤 바닥에서 페이드아웃 후 REDIRECT_URL 로 이동합니다. */}
      {/* (필요시 여기에 후속 일반 콘텐츠를 추가하세요) */}

      {/* ✅ (옵션) 스크롤값 디버그 박스 */}
      <div
        style={{
          position: 'fixed',
          bottom: '20px',
          right: '20px',
          padding: '8px 14px',
          background: 'rgba(235, 114, 198, 0.85)',
          color: 'rgba(1, 14, 1, 1)',
          fontFamily: 'monospace',
          fontSize: '14px',
          borderRadius: '6px',
          zIndex: 99999,
          pointerEvents: 'none',
          boxShadow: '0 0 6px rgba(0,0,0,0.4)',
        }}
      >
        skip
      </div>

      {/* ✅ 페이드아웃 오버레이 */}
      {isFading && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: '#000',
            opacity: 0,
            animation: 'fadeOutOverlay 1.2s forwards',
            zIndex: 100000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontSize: '28px',
            fontWeight: '500',
            letterSpacing: '0.02em',
          }}
        >
          사이트로 이동중...
        </div>
      )}

      {/* ✅ 페이드아웃 애니메이션 정의 */}
      <style>{`
        @keyframes fadeOutOverlay {
          0% { opacity: 0; }
          20% { opacity: 0.2; }
          50% { opacity: 0.6; }
          100% { opacity: 1; }
        }
      `}</style>
    </>
  );
}
