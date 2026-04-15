"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import Script from "next/script";

const ADSENSE_CLIENT = "ca-pub-2918914879248661";
const ADSENSE_SLOT_FOOTER = "1499711707";
const ADSENSE_SLOT_LEFT = "3839980763";
const ADSENSE_SLOT_RIGHT = "5271435750";

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

function pushAd(config: Record<string, unknown> = {}): void {
  try {
    (window.adsbygoogle = window.adsbygoogle || []).push(config);
  } catch {
    // Ignore transient initialization errors from blocked ad scripts.
  }
}

interface AdUnitProps {
  slot: string;
  style: CSSProperties;
  adFormat?: string;
  responsive?: boolean;
}

function AdUnit({ slot, style, adFormat = "auto", responsive = true }: AdUnitProps) {
  const adRef = useRef<HTMLModElement | null>(null);

  useEffect(() => {
    const element = adRef.current;
    if (!element) return;
    if (element.dataset.initialized === "true") return;

    pushAd({});
    element.dataset.initialized = "true";
  }, []);

  return (
    <ins
      ref={adRef}
      className="adsbygoogle block"
      style={style}
      data-ad-client={ADSENSE_CLIENT}
      data-ad-slot={slot}
      data-ad-format={adFormat}
      data-full-width-responsive={responsive ? "true" : "false"}
    />
  );
}

/**
 * News-page-only ad rails + bottom bar using the same AdSense client logic
 * as the main static SpyConverter site.
 */
export function NewsAds() {
  const [showBottomAd, setShowBottomAd] = useState(true);

  return (
    <>
      <Script
        id="spyconverter-news-adsense-script"
        async
        strategy="afterInteractive"
        src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`}
        crossOrigin="anonymous"
      />

      <aside className="pointer-events-none fixed left-4 top-1/2 z-20 hidden -translate-y-1/2 xl:block">
        <div className="pointer-events-auto overflow-hidden rounded-xl border border-slate-200 bg-white/95 p-2 shadow-card backdrop-blur">
          <AdUnit
            slot={ADSENSE_SLOT_LEFT}
            style={{ display: "block", width: "160px", height: "600px" }}
            adFormat="auto"
            responsive={false}
          />
        </div>
      </aside>

      <aside className="pointer-events-none fixed right-4 top-1/2 z-20 hidden -translate-y-1/2 xl:block">
        <div className="pointer-events-auto overflow-hidden rounded-xl border border-slate-200 bg-white/95 p-2 shadow-card backdrop-blur">
          <AdUnit
            slot={ADSENSE_SLOT_RIGHT}
            style={{ display: "block", width: "160px", height: "600px" }}
            adFormat="auto"
            responsive={false}
          />
        </div>
      </aside>

      <div className="pointer-events-none fixed bottom-4 right-4 z-40">
        <button
          type="button"
          onClick={() => setShowBottomAd((prev) => !prev)}
          className="pointer-events-auto rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-md transition hover:border-slate-400 hover:text-slate-900"
        >
          {showBottomAd ? "Hide Bottom Ad" : "Show Bottom Ad"}
        </button>
      </div>

      {showBottomAd ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30">
          <div className="mx-auto max-w-5xl px-4 py-1 sm:px-6 lg:px-8">
            <div className="pointer-events-auto overflow-hidden">
              <AdUnit
                slot={ADSENSE_SLOT_FOOTER}
                style={{ display: "block", minHeight: "90px" }}
                adFormat="auto"
                responsive={true}
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
