"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";

type RouteStop = {
  id: number;
  name: string;
  latitude: string;
  longitude: string;
  order_index: number;
  is_stop?: boolean;
};

type CommuteRoute = {
  id: number;
  name: string;
  route_code: string | null;
  start_point: string;
  end_point: string;
  base_fare: string;
  description: string | null;
  route_description: string | null;
  schedule: string | null;
  service_period: string | null;
  route_color: string | null;
  polyline_color: string | null;
  stops: RouteStop[];
};

const CommuteMapView = dynamic(() => import("./CommuteMapView"), {
  ssr: false,
});

function IntroSplash() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [phase, setPhase] = useState<"visible" | "fading" | "hidden">("visible");

  useEffect(() => {
    const video = videoRef.current;

    if (!video) {
      return;
    }

    const playResult = video.play();

    if (playResult && typeof playResult.catch === "function") {
      playResult.catch(() => {
        setPhase("fading");
      });
    }

    const fallbackTimeoutId = window.setTimeout(() => {
      setPhase("fading");
    }, 9000);

    return () => {
      window.clearTimeout(fallbackTimeoutId);
    };
  }, []);

  useEffect(() => {
    if (phase !== "fading") {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setPhase("hidden");
    }, 500);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [phase]);

  if (phase === "hidden") {
    return null;
  }

  const handleComplete = () => {
    setPhase("fading");
  };

  return (
    <div
      className={`pointer-events-none fixed inset-0 z-[5000] flex items-center justify-center overflow-hidden px-4 py-4 transition-opacity duration-500 ease-out ${
        phase === "fading" ? "opacity-0" : "opacity-100"
      }`}
      aria-hidden="true"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(219,39,119,0.12),transparent_32%),radial-gradient(circle_at_bottom,rgba(53,176,171,0.1),transparent_28%),linear-gradient(135deg,#ffffff_0%,#fff8fb_52%,#f8fffe_100%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.9),rgba(255,255,255,0.72))]" />
      <div className="relative flex h-[min(100svh-2rem,56rem)] w-[min(100vw-2rem,96rem)] items-center justify-center rounded-[2rem] border border-slate-200 bg-white/90 p-3 shadow-[0_32px_120px_rgba(15,23,42,0.14)] backdrop-blur-md md:p-4">
        <video
          ref={videoRef}
          className="h-full w-full rounded-[1.5rem] object-contain"
          src="/davcom.mp4"
          autoPlay
          muted
          playsInline
          preload="auto"
          onEnded={handleComplete}
          onError={handleComplete}
        />
      </div>
    </div>
  );
}

export default function CommuteMapViewLoader({ routes }: { routes: CommuteRoute[] }) {
  return (
    <div className="relative min-h-[100dvh]">
      <CommuteMapView routes={routes} />
      <IntroSplash />
    </div>
  );
}
