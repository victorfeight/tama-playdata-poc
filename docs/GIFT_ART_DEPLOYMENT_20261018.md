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
