# AnyCac SDK

Standalone browser SDK for embedding AnyCac cart, checkout, and payment return flows into external storefronts.

## Install

Load the SDK from a versioned GitHub tag through jsDelivr:

```html
<script src="https://cdn.jsdelivr.net/gh/swebvn/anycac-sdk@v1.0.0/anycac.js"></script>
```

For production, pin to an exact version tag. Do not use an unpinned branch URL.

## Release Model

- Source of truth is `anycac.js`
- Create a semver tag like `v1.0.0`
- GitHub Actions validates the tag against `package.json` and the SDK version string
- The workflow creates a GitHub Release and uploads `anycac.js` plus a SHA-256 checksum

## Local Validation

```bash
npm run check:version
```

## Public API

- `AnyCac.init(config)`
- `AnyCac.addToCart(payload, options)`
- `AnyCac.openCartSlider()`
- `AnyCac.openCartModal()`
- `AnyCac.openModal(url, title)`
- `AnyCac.closeModal()`
- `AnyCac.routePaymentCallbacks()`
- `AnyCac.mountCart(target)`
- `AnyCac.mountCheckout(target)`
- `AnyCac.mountReturn(target)`
- `AnyCac.mountCurrentRoute()`
- `AnyCac.bindCartTrigger(trigger)`
- `AnyCac.on(event, handler)`
- `AnyCac.off(event, handler)`
- `AnyCac.version`
