# YARD SALE — Phase 1: marketplace + wallet linking

"Your Junk Deserves To Be On-Chain"

A working secondhand marketplace where people sign in, list items with photos, browse and search the yard, manage their listings, and link a verified crypto wallet to their account. Minting, companion tokens, escrow and liquidity are prepared but honestly switched off until contracts are deployed.

## What you'll be able to do when this is done

- Sign in by email link (and Google), with a public seller profile and handle.
- Create a listing through a six-step wizard: photos, item details, price and pickup, passport preview, optional token step (shown as "not yet available"), review and publish. Drafts save as you go.
- Upload 3-8 photos with drag/drop, reorder, cover choice, and camera capture on phones. Photos are stripped of location data and stay private until the listing is published.
- Browse and search a real marketplace grid with filters (category, condition, price, city, passport status) and sorts, all reflected in shareable web addresses.
- Open an item page with gallery, seller card, pickup terms, an Item Passport panel, and related items.
- Manage everything in "My Yard": drafts, live, reserved, sold, passports, tokens, orders.
- Connect a crypto wallet and prove ownership by signing a message; the app verifies the signature on the server, rejects replays and expired requests, and stores only the address.
- Read complete Trust & Safety, How It Works, Terms, Privacy, Risk Disclosure and Prohibited Items pages, plus a public Status page showing which network and services are configured.
- Admins get a moderation queue for reports and flagged listings, protected server-side.

Everything chain-write-related (minting, escrow, tokens, pools) shows a precise "configuration required" state linking to Status. Nothing is faked.

## Look and feel

Follows the brief exactly: warm paper #F7F5EF, ink #111111, grass accent #B9F34A used sparingly, soft borders, floating white nav bar with blur, Manrope for interface text and IBM Plex Mono for addresses and hashes, 12-18px radii, cards with borders over shadows, 160-220ms motion with reduced-motion support. The supplied lockup is used unaltered as hero art with alt text "YARD SALE — Your Junk Deserves To Be On-Chain". Three photorealistic yard-sale images are generated for hero, listing flow and pickup sections. Polished at 360/768/1024/1440px.

## Two deviations from the brief

1. Routing uses TanStack Router (this project's fixed router), not React Router. Same routes, same behaviour.
2. Backend uses Lovable Cloud (database, auth, storage, server functions) rather than a separately connected Supabase project — same capabilities, no external account setup. Server-side logic runs as server functions instead of Edge Functions.

## Build order

1. **Foundation** — design tokens, fonts, nav/footer shell, brand asset, generated imagery, static content pages, 404 and error states.
2. **Backend** — enable Lovable Cloud; migrations for profiles, wallets, wallet_nonces, listings, listing_media, private_pickup_details, favorites, reports, moderation_actions, notifications, terms_versions, user_roles; storage buckets `listing-drafts` (private), `listing-public`, `avatars`; grants and row-level security on every table; a role table with a security-definer role check (never a role column on profiles).
3. **Auth and profiles** — magic-link + Google sign-in, profile auto-creation trigger, settings page, session-aware header, sign-out hygiene, protected route gate.
4. **Marketplace reads** — homepage with live featured listings, browse with server-side pagination and URL-driven filters, item detail, public profile pages, favorites, reports.
5. **Sell wizard** — autosaving six-step flow, image validation and re-encoding client- and server-side, possession code (e.g. YARD-7K2P), pickup privacy, publish path.
6. **Dashboard** — My Yard tabs, listing editor with immutable vs editable fields, lifecycle timeline, designed empty states.
7. **Wallet linking** — wagmi + viem connection, server-issued single-use short-lived nonce, EIP-4361 style message, server-side signature verification, unique lowercase address binding, unlink rules, network add/switch support, centralized Robinhood Chain config (mainnet 4663, testnet 46630) defaulting to testnet with mainnet gated off.
8. **Contracts workspace** — `/contracts` with Hardhat, Solidity ^0.8.24, OpenZeppelin 5.x: YardSaleAssetRegistry, YardCompanionToken + YardTokenFactory, YardSaleEscrow, YardLiquidityLocker, with tests, deploy/verify scripts, ABI export, and the "passing tests is not an audit" notice. Not deployed by this project.
9. **Status, admin, seed data, docs** — status page, moderation queue, 10 labelled demo listings, README/ARCHITECTURE/SECURITY/LEGAL-REVIEW-CHECKLIST/CONTRACT-DEPLOYMENT/ATTRIBUTIONS/.env.example.
10. **Verification** — accessibility pass, SEO metadata per route, sitemap/robots, tests for wizard validation, filters, privacy rules and wallet nonce replay, plus browser checks of the main flows at all four widths.

## Technical notes

- Chain config in one typed module; all chain-write features gated behind deployed-address checks with honest disabled states.
- Money stored as integer base units / numeric, never floating point.
- All consequential writes revalidated server-side; browser-supplied addresses, prices and roles treated as untrusted.
- Exact pickup details live in a separate table readable only by seller (and later the funded buyer), never in public storage paths or object metadata.
- Dashboards, settings and admin marked noindex; public pages get canonical URLs and Open Graph metadata.

## Not in this phase

Minting, companion tokens, escrow orders, pickup handoff codes, Uniswap liquidity, and Alchemy gas sponsorship. Their UI surfaces exist as configuration-required panels, and the contracts they need are written and tested here so they can be deployed and switched on next.
