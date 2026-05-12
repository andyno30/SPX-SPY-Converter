const NEWS_PAGE_JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://spyconverter.com/#organization",
      name: "SpyConverter",
      url: "https://spyconverter.com",
    },
    {
      "@type": "Person",
      "@id": "https://spyconverter.com/#andy-no",
      name: "Andy No",
      alternateName: ["Taejun No", "Taejun (Andy) No"],
      jobTitle: "SPX Options Trader",
      description:
        "Andy No is the founder and owner of SpyConverter.com, a web-based tool that helps traders and investors convert SPX (S&P 500 Index) options to SPY (ETF) equivalent.",
      owns: { "@id": "https://spyconverter.com/#organization" },
    },
    {
      "@type": "WebSite",
      "@id": "https://news.spyconverter.com/#website",
      url: "https://news.spyconverter.com",
      name: "SpyConverter News",
      isPartOf: { "@id": "https://spyconverter.com/#organization" },
    },
  ],
};

export default function Head() {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(NEWS_PAGE_JSON_LD),
      }}
    />
  );
}
