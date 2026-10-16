# Market data launch restrictions

Live commercial redistribution remains disabled. No provider contract, exchange permission or legal clearance was supplied or inferred from an existing publicly accessible endpoint. Both local and hosted integration tests use invented market values only. The user states ownership and commercial authority; no independent legal determination is represented here.

The upstream market data and SpyConverter's calculation code are separate rights questions. `Prices`, all five named ratios, computed conversions, ES metadata and contract availability may depend on third-party quotes. A calculated ratio is not automatically exempt from data-provider or exchange restrictions. Dates and quote metadata may also be subject to supplier terms.

The [yfinance project's documentation](https://ranaroussi.github.io/yfinance/) describes its research/education purpose, points users to Yahoo's terms, and warns about personal-use limitations. Its software license does not grant commercial rights to Yahoo data. The current audited updater uses a JavaScript Yahoo client; changing the client library does not establish additional data rights. Counsel must review the applicable [Yahoo terms](https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html), provider contracts and exchange requirements for the actual account, jurisdiction and use case. This document does not declare the existing website's use lawful or unlawful.

Before authorization, document for each instrument/feed:

1. Supplier and exchange ownership; permitted internal use versus distribution to paying API customers.
2. Whether derived ratios, delayed values, quote metadata, caching and historical retention are permitted.
3. Required display delays, attribution, subscriber entitlements, reporting/audits and geographic restrictions.
4. Customer application count, redistribution limitations and contractual flow-down obligations.
5. A signed rights reference and the person approving activation, plus the policy if rights expire.

`API_LIVE_MARKET_DATA_ENABLED=false` is the default. Live delivery additionally requires `API_DATA_LICENSE_APPROVED=true`, a nonempty license reference, a matching licensed-provenance cache, an active paid organization entitlement, and a live key. Synthetic records cannot masquerade as licensed records. The billing adapter supports separate live and test configurations; live checkout is currently disabled while signing/activation prerequisites remain incomplete. Flags document operational authorization; they do not themselves prove legal clearance.

A licensed supplier can later supply an authorized snapshot through the narrow `readSource` interface in `mirror.ts`, preserving the original serializer's input shape and actual quote timestamps. Rights review must cover exact-price and derived outputs. This pathway contains no new supplier polling implementation. Any supplier ingestion change, schedule or production configuration needs separate approval; never add a Yahoo fallback. A customer-supplied-price API is not enabled by this build and would require its own rights and validation review.

The proposed agreement at `/B2B/api/terms/` requires counsel to complete the operator's legal entity/address, governing law, liability terms, statutory rights, refund policy and retention obligations. Use a completed provider signature and private executed document, not a checkbox. Until then, interest/application review and clearly labeled synthetic demonstration are the supported activities.
