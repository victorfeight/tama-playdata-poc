# Gift artwork deployment — 2026-10-18

Published clean canonical main `0066a4e87392ca121b639ddda05d9cf82073c72c`
to https://trade.bbamorachi.us using the existing verified web publisher.
All 387 manifest files matched before publication. Relay service was not restarted.

- Package: `Downloads/Paradise-Gifts-Art-20261018-final`.
- Server package: `/srv/paradise-link-gift/art-0066a4e`.
- Rollback copy: `/srv/paradise-link-gift/before-art-0066a4e`.
- Live web root: `/srv/tama-gifts-poc/web-client/dist`.
- Public entry point references `assets/gifts-BhnlFgvn.js`.
- Public backdrop URL: `/sprites/tama_trade.png?v=f31529fd18fd`.
- Downloaded public image SHA256:
  `f31529fd18fd2539795da9679516f926db913e99a8a173ee5ea3ff926b86303c`.

The version query is necessary because the unversioned image remained cached
after the first deployment. No cache purge or service restart was required.

The two-browser encrypted Gift-preview test passed against the public origin:
fragmented encrypted offers, duplicate offers, non-offer raw bytes, adapter
reconnection/reset, and truthful completion wording. Disposable private rooms
and simulated UART were used; this is not proof of a completed physical trade.
Local evidence: `TamaSuite-validation/home-5.0.33/gift-live-final`.

The corresponding Home renderer uses the same backdrop bytes and native offer
panels. Home installer publication is a separate release gate.

## Website border correction

User requested a website-only correction after confirming Home's image looked fine.
Canonical main `80a4d1c3ab624394285b1159812c04aa0b1a4b20` removes the dark inset
canvas frame for Gifts. The shared renderer retains the Playdate frame by default;
the Gift shell's rounded outer edge remains. Artwork bytes and Home builds are unchanged.

- Clean reproducible package: `Downloads/Paradise-Gifts-Border-20261018`.
- All 387 manifest files verified before deployment.
- Server package: `/srv/paradise-link-gift/border-80a4d1c`.
- Rollback: `/srv/paradise-link-gift/before-border-80a4d1c`.
- Published to the existing Gift web root without restarting the relay.
- TypeScript and production build passed.
- Local and live desktop (1440px) and phone (390px) browser checks passed:
  no inset dark frame, no horizontal overflow, no JavaScript errors, and room
  creation controls visible. This layout-only check does not claim a physical trade.
- Screenshots/receipts: `TamaSuite-validation/gift-border-20261018/{local,live}`.

Related operator delivery: fresh self-contained Windows Studio from canonical
`TamaLicenseStudio:master` `b72a54f` is in
`Downloads/TamaLicenseStudio-20261018-Private-Operator`; native window startup passed.
It uses existing per-user settings and includes Studio's existing licensing keys;
it is a private operator bundle, not a customer release. Home 5.0.33 all-platform
installers remain in `Downloads/TamaHome-5.0.33-All-Platforms`, with their source
and hashes recorded in Home's release receipt. Live Home updater remains unchanged.
