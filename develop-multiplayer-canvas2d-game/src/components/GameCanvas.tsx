"use client";

import { useEffect, useRef } from "react";
import { GameClient } from "@/game/client/game";

export default function GameCanvas() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const client = new GameClient(canvas);
    client.start();
    return () => client.destroy();
  }, []);

  return (
    <canvas
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
  );
}
