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
      description: "Founder and owner of SpyConverter.com.",
      url: "https://spyconverter.com/aboutus.html#founder-profile",
      worksFor: { "@id": "https://spyconverter.com/#organization" },
      image: {
        "@type": "ImageObject",
        "@id": "https://spyconverter.com/#andy-no-image",
        contentUrl: "https://bluetaxledger.com/profile.jpg",
        url: "https://bluetaxledger.com/profile.jpg",
        caption: "Andy No, founder of SpyConverter.com",
      },
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
