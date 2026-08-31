"use client";

import { useEffect, useRef, useState } from "react";
import { GameClient } from "@/game/client/game";

function detectMobile() {
  if (typeof window === "undefined") return false;
  return (
    window.innerWidth <= 900 ||
    /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    "ontouchstart" in window
  );
}

/** localStorage key used to permanently dismiss the mobile Phone tip. */
const PHONE_TIP_IGNORED_KEY = "petalia.phoneTipIgnored";

/** True once the player chose "Ignore" before; the tip should never show again. */
function isPhoneTipIgnored() {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(PHONE_TIP_IGNORED_KEY) === "1";
  } catch {
    return false;
  }
}

export default function GameCanvas() {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showPrompt, setShowPrompt] = useState(() => !isPhoneTipIgnored());

  useEffect(() => {
    const check = () => {
      setIsMobile(detectMobile());
      setIsFullscreen(!!document.fullscreenElement);
    };
    check();
    window.addEventListener("resize", check);
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => {
      window.removeEventListener("resize", check);
      document.removeEventListener("fullscreenchange", onFsChange);
    };
  }, []);

  /** Permanently hide the Phone tip once the player clicks "Ignore". */
  const ignorePhoneTip = () => {
    try {
      localStorage.setItem(PHONE_TIP_IGNORED_KEY, "1");
    } catch {
      /* ignore */
    }
    setShowPrompt(false);
  };

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const client = new GameClient(canvas);
    client.start();
    return () => client.destroy();
  }, []);

  const enterFullscreen = async () => {
    try {
      const el = document.documentElement;
      if (el.requestFullscreen) {
        await el.requestFullscreen();
      } else if ((el as any).webkitRequestFullscreen) {
        await (el as any).webkitRequestFullscreen();
      }
      setIsFullscreen(true);
      setShowPrompt(false);
    } catch {
      setShowPrompt(false);
    }
  };

  return (
    <>
      <canvas
        id="gameCanvas"
        ref={ref}
        style={{
          position: "fixed",
          inset: 0,
          width: "100vw",
          height: "100vh",
          display: "block",
          touchAction: "none",
          cursor: "default",
          background: "#0b1016",
        }}
      />
      {isMobile && !isFullscreen && showPrompt && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            background: "rgba(11,16,22,0.92)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
            textAlign: "center",
            fontFamily: '"Trebuchet MS", "Segoe UI", sans-serif',
            color: "white",
          }}
        >
          <div
            style={{
              maxWidth: 360,
              width: "100%",
              background: "rgba(28,36,46,0.95)",
              borderRadius: 14,
              padding: 20,
              border: "4px solid rgba(0,0,0,0.35)",
            }}
          >
            <div style={{ fontSize: 26, fontWeight: 900, color: "#ffe763", marginBottom: 12, textShadow: "0 0 0 rgba(0,0,0,0.5)" }}>
              PETALIA.IO
            </div>
            <div style={{ fontSize: 16, lineHeight: 1.4, marginBottom: 14, opacity: 0.9 }}>
              For the best experience on phone, please enter fullscreen before playing.
              <br />
              <span style={{ fontSize: 13, opacity: 0.7 }}>
                Landscape mode + fullscreen gives more space, smoother controls and bigger buttons.
              </span>
            </div>
            <button
              onClick={enterFullscreen}
              style={{
                width: "100%",
                height: 52,
                borderRadius: 10,
                border: "none",
                background: "#3fae60",
                color: "white",
                fontSize: 18,
                fontWeight: 900,
                cursor: "pointer",
                boxShadow: "0 5px 0 #2d7a43",
                marginBottom: 10,
              }}
            >
              ENTER FULLSCREEN
            </button>
            <button
              onClick={ignorePhoneTip}
              style={{
                width: "100%",
                height: 40,
                borderRadius: 10,
                border: "2px solid rgba(255,255,255,0.2)",
                background: "rgba(255,255,255,0.08)",
                color: "rgba(255,255,255,0.8)",
                fontSize: 14,
                fontWeight: 700,
                cursor: "pointer",
                marginBottom: 8,
              }}
            >
              Ignore — don't show again
            </button>
            <button
              onClick={() => setShowPrompt(false)}
              style={{
                width: "100%",
                height: 36,
                borderRadius: 10,
                border: "none",
                background: "transparent",
                color: "rgba(255,255,255,0.55)",
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Continue without fullscreen
            </button>
            <div style={{ marginTop: 8, fontSize: 12, opacity: 0.55 }}>
              You can always enter fullscreen later from the browser menu or by rotating your phone to landscape.
            </div>
          </div>
        </div>
      )}
    </>
  );
}
