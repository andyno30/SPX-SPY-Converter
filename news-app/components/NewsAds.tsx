"use client";

import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import Script from "next/script";

const ADSENSE_CLIENT = "ca-pub-2918914879248661";
const ADSENSE_SLOT_FOOTER = "1499711707";
const ADSENSE_SLOT_LEFT = "3839980763";
const ADSENSE_SLOT_RIGHT = "5271435750";

declare global {
  interface Window {
    adsbygoogle?: unknown[];
    __spyconverterNewsAdsInit?: boolean;
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
  useEffect(() => {
    if (window.__spyconverterNewsAdsInit) return;

    pushAd({
      google_ad_client: ADSENSE_CLIENT,
      enable_page_level_ads: true,
    });
    window.__spyconverterNewsAdsInit = true;
  }, []);

  return (
    <>
      <Script
        id="spyconverter-news-adsense-script"
        async
        strategy="afterInteractive"
        src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`}
        crossOrigin="anonymous"
      />

      <aside className="pointer-events-none fixed left-4 top-1/2 z-20 hidden -translate-y-1/2 2xl:block">
        <div className="pointer-events-auto overflow-hidden rounded-xl border border-slate-200 bg-white/95 p-2 shadow-card backdrop-blur">
          <AdUnit
            slot={ADSENSE_SLOT_LEFT}
            style={{ display: "block" }}
            adFormat="auto"
            responsive={true}
          />
        </div>
      </aside>

      <aside className="pointer-events-none fixed right-4 top-1/2 z-20 hidden -translate-y-1/2 2xl:block">
        <div className="pointer-events-auto overflow-hidden rounded-xl border border-slate-200 bg-white/95 p-2 shadow-card backdrop-blur">
          <AdUnit
            slot={ADSENSE_SLOT_RIGHT}
            style={{ display: "block" }}
            adFormat="auto"
            responsive={true}
          />
        </div>
      </aside>

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/90">
        <div className="mx-auto max-w-5xl px-4 py-2 sm:px-6 lg:px-8">
          <div className="pointer-events-auto overflow-hidden rounded-lg border border-slate-200 bg-white px-2 py-1">
            <AdUnit
              slot={ADSENSE_SLOT_FOOTER}
              style={{ display: "block" }}
              adFormat="auto"
              responsive={true}
            />
          </div>
        </div>
      </div>
    </>
  );
}
