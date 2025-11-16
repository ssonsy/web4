import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./style.css";

function useCustomCursor() {
  useEffect(() => {
    const PNG_URL = "/cursor.png"; // public 폴더 기준
    const SIZE = 50;               // 
    const HOT_X = SIZE / 2;        // 중심축 X = 12.5px
    const HOT_Y = SIZE / 2;        // 중심축 Y = 12.5px

    // 커서 엘리먼트 생성
    let el = document.getElementById("custom-cursor");
    if (!el) {
      el = document.createElement("div");
      el.id = "custom-cursor";
      document.body.appendChild(el);
    }

    // 스타일 지정 + 회전 애니메이션 추가
    Object.assign(el.style, {
      position: "fixed",
      top: "0px",
      left: "0px",
      width: `${SIZE}px`,
      height: `${SIZE}px`,
      transform: `translate(${-HOT_X}px, ${-HOT_Y}px) rotate(0deg)`,
      backgroundImage: `url("${PNG_URL}")`,
      backgroundSize: "contain",
      backgroundRepeat: "no-repeat",
      pointerEvents: "none",
      zIndex: "999999",
      transition: "transform 0.05s linear",
      animation: "spinCursor 8s linear infinite",
      transformOrigin: "center center", // ✅ 중심 회전
    });

    // 커서 이동
    let x = 0, y = 0;
    const onMove = (e) => {
      const { clientX, clientY } = e.touches?.[0] ?? e;
      x = clientX;
      y = clientY;
      el.style.left = `${x - HOT_X}px`;
      el.style.top = `${y - HOT_Y}px`;
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });

    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("touchmove", onMove);
    };
  }, []);
}

function Root() {
  useCustomCursor();
  return (
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<Root />);
