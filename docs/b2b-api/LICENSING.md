# Market-data authorization record

On October 16, the owner explicitly requested paid Checkout and live shared-cache JSON delivery and stated that market-data licensing would be handled separately. Production now uses the distinct owner_authorized authorization mode, reference owner-activation-2026-10-16-codex. No independent licensing determination or provider-document approval is represented. API_DATA_LICENSE_APPROVED remains false. Synthetic integration tests remain synthetic; a read-only source/cache parity comparison additionally verified production serialization without making a Yahoo request.

The upstream market data and SpyConverter's calculation code are separate rights questions. `Prices`, all five named ratios, computed conversions, ES metadata and contract availability may depend on third-party quotes. A calculated ratio is not automatically exempt from data-provider or exchange restrictions. Dates and quote metadata may also be subject to supplier terms.

The [yfinance project's documentation](https://ranaroussi.github.io/yfinance/) describes its research/education purpose, points users to Yahoo's terms, and warns about personal-use limitations. Its software license does not grant commercial rights to Yahoo data. The current audited updater uses a JavaScript Yahoo client; changing the client library does not establish additional data rights. Counsel must review the applicable [Yahoo terms](https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html), provider contracts and exchange requirements for the actual account, jurisdiction and use case. This document does not declare the existing website's use lawful or unlawful.

Before authorization, document for each instrument/feed:

1. Supplier and exchange ownership; permitted internal use versus distribution to paying API customers.
2. Whether derived ratios, delayed values, quote metadata, caching and historical retention are permitted.
3. Required display delays, attribution, subscriber entitlements, reporting/audits and geographic restrictions.
4. Customer application count, redistribution limitations and contractual flow-down obligations.
5. A signed rights reference and the person approving activation, plus the policy if rights expire.

`API_LIVE_MARKET_DATA_ENABLED=false` and the owner-delivery flag default to false. Production live delivery requires the kill switch plus either a documented licensed mode or explicit production-only owner authorization. Each mode requires a nonempty matching reference on the snapshot. Pending-review and synthetic data cannot pass a live authorization check. A paid organization, accepted approved Terms, Business approval where applicable and a live key remain mandatory. Operational authorization does not itself prove legal clearance.

A licensed supplier can later supply an authorized snapshot through the narrow `readSource` interface in `mirror.ts`, preserving the original serializer's input shape and actual quote timestamps. Rights review must cover exact-price and derived outputs. This pathway contains no new supplier polling implementation. Any supplier ingestion change, schedule or production configuration needs separate approval; never add a Yahoo fallback. A customer-supplied-price API is not enabled by this build and would require its own rights and validation review.

The owner approved Terms version 2026-10-16-v1. New customers explicitly accept the initially unchecked checkbox, and the authenticated server stores an immutable acceptance receipt and audit evidence. Historical provider signatures are preserved. Customer acceptance does not establish upstream supplier permissions. No DocuSign account is required for new subscriptions.
