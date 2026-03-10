"use client";

export default function VoidFunnel() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        pointerEvents: "none",
        backgroundImage: "url(/wormhole.jpg)",
        backgroundSize: "85%",
        backgroundPosition: "center 48%",
        backgroundRepeat: "no-repeat",
        backgroundColor: "#ebebeb",
      }}
    />
  );
}
