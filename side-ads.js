(function initializeSiteSideAds() {
  const sideAdMedia = window.matchMedia("(min-width: 1280px)");
  const sides = [
    { position: "left", slot: "3839980763" },
    { position: "right", slot: "5271435750" },
  ];

  function createSideAd({ position, slot }) {
    const aside = document.createElement("aside");
    aside.className = `site-side-ad site-side-ad--${position}`;
    aside.setAttribute("aria-label", "Advertisement");

    const label = document.createElement("span");
    label.className = "site-side-ad-label";
    label.textContent = "Advertisement";

    const unit = document.createElement("ins");
    unit.className = "adsbygoogle site-side-ad-unit";
    unit.dataset.adClient = "ca-pub-2918914879248661";
    unit.dataset.adSlot = slot;
    unit.dataset.adFormat = "auto";
    unit.dataset.fullWidthResponsive = "false";

    aside.append(label, unit);
    document.body.append(aside);
    return unit;
  }

  const units = sides.map(createSideAd);

  function requestVisibleSideAds() {
    if (!sideAdMedia.matches) return;

    units.forEach((unit) => {
      if (unit.dataset.adRequested === "true") return;
      unit.dataset.adRequested = "true";

      try {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      } catch {
        // Ad blockers and transient AdSense failures should not affect page content.
      }
    });
  }

  sideAdMedia.addEventListener?.("change", requestVisibleSideAds);
  window.addEventListener("load", requestVisibleSideAds);
  requestVisibleSideAds();
})();
