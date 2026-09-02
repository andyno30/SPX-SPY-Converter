(function initializeProFeatureAds() {
  const sideAdMedia = window.matchMedia("(min-width: 1320px)");
  const bottomAd = document.getElementById("pro-feature-bottom-ad");
  const bottomAdToggle = document.querySelector(".pro-feature-bottom-ad-toggle");

  function requestAds(units) {
    units.forEach((unit) => {
      if (unit.dataset.adRequested === "true") return;
      unit.dataset.adRequested = "true";

      try {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      } catch {
        // Ad blockers and transient AdSense failures should not affect the tools.
      }
    });
  }

  function initializeVisibleAds() {
    requestAds(document.querySelectorAll(".pro-feature-bottom-ad-unit"));

    if (sideAdMedia.matches) {
      requestAds(document.querySelectorAll(".pro-feature-side-ad-unit"));
    }
  }

  function toggleBottomAd() {
    if (!bottomAd || !bottomAdToggle) return;
    const shouldShow = bottomAd.hidden;

    bottomAd.hidden = !shouldShow;
    bottomAdToggle.textContent = shouldShow ? "Hide Bottom Ad" : "Show Bottom Ad";
    bottomAdToggle.setAttribute("aria-expanded", String(shouldShow));
  }

  bottomAdToggle?.addEventListener("click", toggleBottomAd);
  sideAdMedia.addEventListener?.("change", initializeVisibleAds);
  window.addEventListener("load", initializeVisibleAds);
  initializeVisibleAds();
})();
