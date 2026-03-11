# AnyCac SDK

Standalone browser SDK for embedding AnyCac cart, checkout, and payment return flows into external storefronts.

## Install

Load the SDK from your Cloudflare-hosted URL:

```html
<script src="https://anycac-sdk.pages.dev/public/anycac.js"></script>
```

If you later attach a custom domain, replace the hosted URL with your own host.

## Cloudflare Deployment

- This repo deploys as a tiny Worker that serves static assets from `public/`
- `public/anycac.js` is currently served at `/public/anycac.js`
- `worker.js` does not run business logic; it only forwards requests to the static asset binding
- This setup is useful when your platform forces `npx wrangler deploy`
- After deploy, the SDK is available at `https://anycac-sdk.pages.dev/public/anycac.js`

If your deploy environment forces `npx wrangler deploy`, this repository is now configured for that flow.

If you deploy from the CLI, use:

```bash
npx wrangler deploy
```


This keeps the repo minimal: one SDK file plus documentation.

## Integration Guide

This guide explains how customers can integrate the AnyCac SDK into their website.

## Overview

AnyCac SDK lets you:

- Add products to Woo cart from your own UI
- Open a right-side cart slider from any trigger element
- Embed cart, checkout, and return (thank you) pages in your site
- Handle PayPal/Stripe redirect returns automatically

Your payment backend stays in Woo with the AnyCac-compatible WooCommerce plugin.

## 1) Include the SDK

Use your deployed Cloudflare SDK URL:

```html
<script src="https://anycac-sdk.pages.dev/public/anycac.js"></script>
```

If you attach a custom domain, use that instead.

## 2) Initialize

Call `AnyCac.init()` once on page load.

```js
AnyCac.init({
	paymentStore: 'https://woo-store.test', // required
	autoRouteCallbacks: true, // optional (default: true)
	autoMount: true, // optional (default: true)
	cartTrigger: '#anycacCartTrigger', // optional
	routes: {
		cart: { path: '/cart', container: '#cartFrame' }, // path required, container optional
		checkout: { path: '/checkout', container: '#checkoutFrame' }, // path required, container optional
		return: { path: '/thank-you', container: '#thankYouFrame' } // path required, container optional
	},
	storageKey: 'anycac_payment_state' // optional
})
```

## 3) Config Reference

- `paymentStore` (string, required)
	- Base URL of your Woo payment store
- `autoRouteCallbacks` (boolean, default `true`)
	- Auto-detects return query params and routes to checkout/thank-you pages
- `autoMount` (boolean, default `true`)
	- Auto-mounts iframe for current configured route
- `cartTrigger` (string | Element | NodeList | Element[])
	- Click trigger(s) that open cart slider
- `routes`
	- `cart.path`, `checkout.path`, `return.path`
	- Optional `container` selector for embedding iframe into existing element
- `storageKey` (string, optional)
	- Session storage key used internally for payment redirect state

## 4) Add to Cart from Your UI

Use `AnyCac.addToCart(payload)` from your product card/button.

```js
AnyCac.addToCart({
	name: 'Premium T-Shirt',
	price: 29.99,
	sku: 'TSHIRT-2026',
	quantity: 1,
	url: 'https://example.com/products/premium-tshirt',
	image_url: 'https://example.com/image.jpg',
	extra: { color: 'White', size: 'M' },
	meta: { source: 'landing-page' }
}, { openSlider: true })
```

Options:

- `openSlider: true` (default behavior)
- `openModal: false` and `openSlider: false` to send command without opening slider

## 5) Cart Slider Trigger

If you pass `cartTrigger`, SDK binds click automatically.

```html
<button id="anycacCartTrigger">Cart</button>
```

You can also bind manually:

```js
AnyCac.bindCartTrigger('#anycacCartTrigger')
```

Open programmatically:

```js
AnyCac.openCartSlider()
```

## 6) Route Integration Pattern

Create 3 site routes/pages:

- Cart page (`/cart`)
- Checkout page (`/checkout`)
- Return/Thank-you page (`/thank-you`)

Each page should have an iframe container or let SDK mount into `document.body`.

### Vanilla Example

```html
<div class="native-frame">
	<iframe id="checkoutFrame"></iframe>
</div>
<script>
	AnyCac.init({
		paymentStore: 'https://woo-store.test',
		routes: {
			cart: { path: '/cart', container: '#cartFrame' },
			checkout: { path: '/checkout', container: '#checkoutFrame' },
			return: { path: '/thank-you', container: '#thankYouFrame' }
		}
	})
</script>
```

### React Router Example

If the provider returns to `/checkout.html` or `/thank-you.html`, add redirects:

- `/checkout.html` -> `/checkout`
- `/cart.html` -> `/cart`
- `/thank-you.html` -> `/thank-you`

## 7) Events

Subscribe with:

```js
AnyCac.on('cart.added', handler)
AnyCac.on('cart.error', handler)
AnyCac.on('payment.redirect', handler)
AnyCac.on('payment.complete', handler)
AnyCac.on('modal.opened', handler)
AnyCac.on('modal.closed', handler)
AnyCac.on('transport.response', handler)
```

Unsubscribe:

```js
AnyCac.off('cart.added', handler)
```

## 8) Payment Return Flow (PayPal / Stripe)

Expected flow:

1. Customer checkout in embedded iframe
2. Redirect to payment provider in top window
3. Provider returns to store callback URL with params
4. SDK detects params and routes to configured `return` or `checkout`
5. Woo callback is forwarded into iframe (`anycac_iframe_forward=1`) to finalize and show thank-you

If callback lands on legacy `.html` paths, route those paths to your real frontend routes.

## 9) Methods Summary

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

## 10) Troubleshooting

- Callback stays on homepage or root
	- Ensure `autoRouteCallbacks: true`
	- Ensure route paths in config match real frontend paths
- Cart slider opens but add-to-cart appears delayed
	- Woo iframe still needs AJAX and render time; this is expected
- Stripe opens inside iframe
	- Ensure the payment store correctly redirects the top window for hosted checkout flows
- Thank-you not shown
	- Confirm return params are routed to `return.path`
	- Ensure the `return` page container exists if using an explicit `container`

## 11) Recommended Customer Integration Checklist

- Add the AnyCac script to all shop, cart, checkout, and return pages
- Add one `AnyCac.init(...)` call on app boot
- Configure `routes` to your real frontend paths
- Add a nav cart icon and set `cartTrigger`
- Wire product buttons to `AnyCac.addToCart(...)`
- Verify full PayPal and Stripe round-trip in sandbox
