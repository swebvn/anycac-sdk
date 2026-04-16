(function (global) {
    'use strict';

    var SDK_VERSION = '1.1.0';

    var DEFAULT_CONFIG = {
        paymentStore: 'https://deceit.test',
        autoRouteCallbacks: true,
        autoMount: true,
        warmCartIframe: false,
        routes: {
            cart: { path: '/cart', container: '' },
            checkout: { path: '/checkout', container: '' },
            return: { path: '/thank-you', container: '' },
        },
        cartTrigger: '',
        storageKey: 'anycac_payment_state'
    };

    var state = {
        config: DEFAULT_CONFIG,
        listeners: {},
        modal: null,
        messageListenerAttached: false,
        currentView: '',
        preconnectApplied: false,
        cartWarmupStarted: false
    };

    function appendPreconnectLink(rel, href) {
        if (!href) {
            return;
        }

        var selector = 'link[rel="' + rel + '"][href="' + href + '"]';
        if (document.head.querySelector(selector)) {
            return;
        }

        var link = document.createElement('link');
        link.rel = rel;
        link.href = href;
        if (rel === 'preconnect') {
            link.crossOrigin = 'anonymous';
        }
        document.head.appendChild(link);
    }

    function applyPreconnectHints() {
        if (state.preconnectApplied || !document.head) {
            return;
        }

        state.preconnectApplied = true;

        var paymentStoreOrigin = '';
        try {
            paymentStoreOrigin = new URL(getPaymentStoreBase()).origin;
        } catch (error) {
            paymentStoreOrigin = '';
        }

        if (paymentStoreOrigin) {
            appendPreconnectLink('dns-prefetch', paymentStoreOrigin);
            appendPreconnectLink('preconnect', paymentStoreOrigin);
        }

        appendPreconnectLink('dns-prefetch', 'https://www.paypal.com');
        appendPreconnectLink('preconnect', 'https://www.paypal.com');
        appendPreconnectLink('dns-prefetch', 'https://www.sandbox.paypal.com');
        appendPreconnectLink('preconnect', 'https://www.sandbox.paypal.com');
        appendPreconnectLink('dns-prefetch', 'https://checkout.stripe.com');
        appendPreconnectLink('preconnect', 'https://checkout.stripe.com');
    }

    function emit(eventName, payload) {
        var handlers = state.listeners[eventName] || [];
        handlers.forEach(function (handler) {
            try {
                handler(payload);
            } catch (error) {
                console.error('[AnyCac SDK] Event handler failed:', error);
            }
        });
    }

    function on(eventName, handler) {
        if (!state.listeners[eventName]) {
            state.listeners[eventName] = [];
        }
        state.listeners[eventName].push(handler);
    }

    function off(eventName, handler) {
        if (!state.listeners[eventName]) {
            return;
        }
        state.listeners[eventName] = state.listeners[eventName].filter(function (item) {
            return item !== handler;
        });
    }

    function normalizePath(path) {
        if (typeof path !== 'string' || !path) {
            return '/';
        }
        if (path.charAt(0) === '/') {
            return path;
        }
        return '/' + path;
    }

    function normalizePathname(pathname) {
        var path = pathname || '/';
        if (path.length > 1 && path.charAt(path.length - 1) === '/') {
            return path.slice(0, -1);
        }
        return path;
    }

    function normalizeRoutePathPattern(path) {
        return normalizePathname(normalizePath(path));
    }

    function isDynamicRoutePath(path) {
        return path.indexOf('*') !== -1 || path.indexOf(':') !== -1;
    }

    function mergeRoutePaths(pathInput, fallbackPath, legacyPaths) {
        var rawPaths = [];
        if (typeof pathInput === 'string' && pathInput) {
            rawPaths.push(pathInput);
        } else if (Array.isArray(pathInput)) {
            for (var i = 0; i < pathInput.length; i += 1) {
                if (typeof pathInput[i] === 'string' && pathInput[i]) {
                    rawPaths.push(pathInput[i]);
                }
            }
        }
        if (Array.isArray(legacyPaths)) {
            for (var j = 0; j < legacyPaths.length; j += 1) {
                if (typeof legacyPaths[j] === 'string' && legacyPaths[j]) {
                    rawPaths.push(legacyPaths[j]);
                }
            }
        }
        if (typeof fallbackPath === 'string' && fallbackPath) {
            rawPaths.push(fallbackPath);
        }
        if (!rawPaths.length) {
            rawPaths.push('/');
        }

        var normalized = [];
        var seen = {};
        for (var k = 0; k < rawPaths.length; k += 1) {
            var normalizedPath = normalizeRoutePathPattern(rawPaths[k]);
            if (seen[normalizedPath]) {
                continue;
            }
            seen[normalizedPath] = true;
            normalized.push(normalizedPath);
        }

        if (!normalized.length) {
            normalized.push('/');
        }

        return normalized;
    }

    function pickPrimaryRoutePath(paths) {
        for (var i = 0; i < paths.length; i += 1) {
            if (!isDynamicRoutePath(paths[i])) {
                return paths[i];
            }
        }
        return paths[0];
    }

    function buildRouteConfig(routeInput, fallbackRoute) {
        var input = routeInput || {};
        var paths = mergeRoutePaths(input.path, fallbackRoute.path, input.paths);
        return {
            path: pickPrimaryRoutePath(paths),
            matchPaths: paths,
            container: input.container || ''
        };
    }

    function getRouteMatchPaths(route) {
        if (Array.isArray(route && route.matchPaths) && route.matchPaths.length) {
            return route.matchPaths;
        }

        if (Array.isArray(route && route.path) && route.path.length) {
            return mergeRoutePaths(route.path, '/', null);
        }

        if (typeof (route && route.path) === 'string' && route.path) {
            return [normalizeRoutePathPattern(route.path)];
        }

        return ['/'];
    }

    function getRoutePrimaryPath(route) {
        return pickPrimaryRoutePath(getRouteMatchPaths(route));
    }

    function routePathMatches(pathPattern, pathname) {
        var normalizedPathname = normalizePathname(pathname);
        var normalizedPattern = normalizeRoutePathPattern(pathPattern);

        if (normalizedPathname === normalizedPattern) {
            return true;
        }

        if (!isDynamicRoutePath(normalizedPattern)) {
            return false;
        }

        var escapedPattern = normalizedPattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
        var regexPattern = escapedPattern
            .replace(/\*/g, '.*')
            .replace(/:[A-Za-z0-9_]+/g, '[^/]+');

        return new RegExp('^' + regexPattern + '$').test(normalizedPathname);
    }

    function routeMatches(route, pathname) {
        if (!route) {
            return false;
        }

        var paths = getRouteMatchPaths(route);
        for (var i = 0; i < paths.length; i += 1) {
            if (routePathMatches(paths[i], pathname)) {
                return true;
            }
        }

        return false;
    }

    function mergeConfig(rawConfig) {
        var input = rawConfig || {};

        var paymentStore = DEFAULT_CONFIG.paymentStore;
        if (typeof input.paymentStore === 'string' && input.paymentStore) {
            paymentStore = input.paymentStore;
        } else if (typeof input.wooStoreBaseUrl === 'string' && input.wooStoreBaseUrl) {
            paymentStore = input.wooStoreBaseUrl;
        }

        var routesInput = input.routes || {};
        var cartTrigger = input.cartTrigger || (routesInput.cart && routesInput.cart.trigger) || '';
        var returnRouteInput = routesInput.return || {};
        var thankYouRouteInput = routesInput.thankYou || {};
        var returnRoutePath = returnRouteInput.path;
        var returnLegacyPaths = [];
        if (Array.isArray(returnRouteInput.paths)) {
            returnLegacyPaths = returnLegacyPaths.concat(returnRouteInput.paths);
        }
        if (returnRoutePath == null && thankYouRouteInput.path != null) {
            returnRoutePath = thankYouRouteInput.path;
        }
        if (Array.isArray(thankYouRouteInput.paths)) {
            returnLegacyPaths = returnLegacyPaths.concat(thankYouRouteInput.paths);
        }

        var normalizedRoutes = {
            checkout: buildRouteConfig(routesInput.checkout, DEFAULT_CONFIG.routes.checkout),
            return: buildRouteConfig({
                path: returnRoutePath,
                paths: returnLegacyPaths,
                container: returnRouteInput.container || thankYouRouteInput.container || ''
            }, DEFAULT_CONFIG.routes.return),
            cart: buildRouteConfig(routesInput.cart, DEFAULT_CONFIG.routes.cart)
        };

        return {
            paymentStore: paymentStore,
            autoRouteCallbacks: typeof input.autoRouteCallbacks === 'boolean' ? input.autoRouteCallbacks : DEFAULT_CONFIG.autoRouteCallbacks,
            autoMount: typeof input.autoMount === 'boolean' ? input.autoMount : DEFAULT_CONFIG.autoMount,
            warmCartIframe: !!input.warmCartIframe,
            routes: normalizedRoutes,
            cartTrigger: cartTrigger,
            storageKey: (typeof input.storageKey === 'string' && input.storageKey) ? input.storageKey : DEFAULT_CONFIG.storageKey
        };
    }

    function startCartWarmup() {
        if (!state.config.warmCartIframe || state.cartWarmupStarted) {
            return;
        }

        state.cartWarmupStarted = true;

        var warm = function () {
            var modal = ensureModal();
            var cartUrl = getPaymentStoreBase() + '/cart/';
            if (modal.iframe.src !== cartUrl) {
                modal.iframe.dataset.anycacLoaded = '0';
                modal.iframe.onload = function () {
                    modal.iframe.dataset.anycacLoaded = '1';
                };
                modal.iframe.src = cartUrl;
            }
        };

        if (typeof window.requestIdleCallback === 'function') {
            window.requestIdleCallback(warm, { timeout: 1500 });
            return;
        }

        window.setTimeout(warm, 300);
    }

    function getTriggerElements(trigger) {
        if (!trigger) {
            return [];
        }

        if (typeof trigger === 'string') {
            return Array.prototype.slice.call(document.querySelectorAll(trigger));
        }

        if (trigger instanceof Element) {
            return [trigger];
        }

        if (typeof NodeList !== 'undefined' && trigger instanceof NodeList) {
            return Array.prototype.slice.call(trigger);
        }

        if (Array.isArray(trigger)) {
            return trigger.filter(function (item) {
                return item instanceof Element;
            });
        }

        return [];
    }

    function bindCartTrigger(trigger) {
        var elements = getTriggerElements(trigger);
        if (!elements.length) {
            return;
        }

        elements.forEach(function (element) {
            if (!element || element.dataset.anycacCartTriggerBound === '1') {
                return;
            }

            element.dataset.anycacCartTriggerBound = '1';
            element.addEventListener('click', function (event) {
                event.preventDefault();
                openCartSlider();
            });
        });
    }

    function getPaymentStoreBase() {
        return state.config.paymentStore.replace(/\/$/, '');
    }

    function routeToUrl(routeName) {
        var route = state.config.routes[routeName];
        if (!route) {
            throw new Error('Unknown AnyCac route: ' + routeName);
        }
        return new URL(getRoutePrimaryPath(route), window.location.origin);
    }

    function routeToBootstrapUrl(routeName) {
        var route = DEFAULT_CONFIG.routes[routeName];
        if (!route) {
            throw new Error('Unknown AnyCac bootstrap route: ' + routeName);
        }
        return new URL(getRoutePrimaryPath(route), window.location.origin);
    }

    function hasPayPalReturn(url) {
        return url.searchParams.has('woo-mecom-return') && url.searchParams.has('order_id');
    }

    function hasPayPalCancel(url) {
        return url.searchParams.has('cancel') && url.searchParams.has('token') && url.searchParams.has('site_type');
    }

    function hasOverChargeReturn(url) {
        return url.searchParams.has('mecom-paypal-return-oc-result') && url.searchParams.has('order_id');
    }

    function hasStripeReturnSuccess(url) {
        return url.searchParams.has('cs_handle_stripe_checkout_session_success')
            && url.searchParams.has('order_id')
            && url.searchParams.has('stripe_session_id');
    }

    function hasStripeReturnCancel(url) {
        return url.searchParams.has('cs_handle_stripe_checkout_session_cancelled')
            && url.searchParams.has('order_id')
            && url.searchParams.has('stripe_session_id');
    }

    function hasRelayParams(url) {
        return hasPayPalReturn(url)
            || hasPayPalCancel(url)
            || hasOverChargeReturn(url)
            || hasStripeReturnSuccess(url)
            || hasStripeReturnCancel(url);
    }

    function isPayPalReturnSuccess(url) {
        return hasPayPalReturn(url)
            && url.searchParams.get('error') === '0'
            && url.searchParams.get('cancel') === '0';
    }

    function isSuccessfulReturn(url) {
        return isPayPalReturnSuccess(url) || hasStripeReturnSuccess(url);
    }

    function getCurrentRouteName() {
        var pathname = normalizePathname(window.location.pathname);
        var routeNames = Object.keys(state.config.routes);

        for (var i = 0; i < routeNames.length; i += 1) {
            var name = routeNames[i];
            if (routeMatches(state.config.routes[name], pathname)) {
                return name;
            }
        }
        return '';
    }

    function isKnownBootstrapRoute(pathname) {
        var normalizedPathname = normalizePathname(pathname);

        if (routeMatches(DEFAULT_CONFIG.routes.checkout, normalizedPathname)) {
            return true;
        }

        if (routeMatches(DEFAULT_CONFIG.routes.return, normalizedPathname)) {
            return true;
        }

        if (routeMatches(DEFAULT_CONFIG.routes.cart, normalizedPathname)) {
            return true;
        }

        if (normalizedPathname === '/checkout' || normalizedPathname === '/thank-you' || normalizedPathname === '/cart') {
            return true;
        }

        return false;
    }

    function recoverCallbackBeforeInit() {
        var currentUrl = new URL(window.location.href);
        if (!hasRelayParams(currentUrl)) {
            return false;
        }

        if (isKnownBootstrapRoute(currentUrl.pathname)) {
            return false;
        }

        var destination = routeToBootstrapUrl(isSuccessfulReturn(currentUrl) ? 'return' : 'checkout');
        destination.search = currentUrl.search;
        window.location.replace(destination.toString());
        return true;
    }

    function savePaymentState(data) {
        try {
            sessionStorage.setItem(state.config.storageKey, JSON.stringify(data));
        } catch (error) {
            console.error('[AnyCac SDK] Failed to save payment state:', error);
        }
    }

    function clearPaymentState() {
        try {
            sessionStorage.removeItem(state.config.storageKey);
        } catch (error) {
            console.error('[AnyCac SDK] Failed to clear payment state:', error);
        }
    }

    function redirectToReturn(orderData) {
        var target = routeToUrl('return');
        if (orderData && orderData.order_id) {
            target.searchParams.set('order_id', String(orderData.order_id));
        }
        if (orderData && orderData.order_key) {
            target.searchParams.set('order_key', String(orderData.order_key));
        }
        if (orderData && orderData.status) {
            target.searchParams.set('status', String(orderData.status));
        }
        window.location.href = target.toString();
    }

    function findFrameByEventSource(sourceWindow) {
        if (!sourceWindow) {
            return null;
        }

        var frames = document.querySelectorAll('iframe');
        for (var i = 0; i < frames.length; i += 1) {
            if (frames[i].contentWindow === sourceWindow) {
                return frames[i];
            }
        }

        return null;
    }

    function syncFrameHeightFromMessage(event, payload) {
        var frame = findFrameByEventSource(event.source);
        if (!frame) {
            var allFrames = document.querySelectorAll('iframe');
            if (allFrames.length === 1) {
                frame = allFrames[0];
            }
        }

        if (!frame) {
            return;
        }

        if (state.modal && state.modal.iframe === frame) {
            return;
        }

        var rawHeight = parseInt(payload && payload.height ? payload.height : 0, 10);
        if (!rawHeight || rawHeight < 300) {
            return;
        }

        frame.style.height = rawHeight + 'px';
    }

    function requestFrameHeight(frame) {
        if (!frame || !frame.contentWindow) {
            return;
        }

        try {
            frame.contentWindow.postMessage({ type: 'anycac-request-frame-height' }, '*');
        } catch (error) {
            // ignore cross-origin access issues
        }
    }

    function bindFrameAutoResize(frame) {
        if (!frame || frame.dataset.anycacResizeBound === '1') {
            return;
        }

        frame.dataset.anycacResizeBound = '1';
        frame.setAttribute('scrolling', 'no');

        frame.addEventListener('load', function () {
            requestFrameHeight(frame);
            setTimeout(function () {
                requestFrameHeight(frame);
            }, 250);
            setTimeout(function () {
                requestFrameHeight(frame);
            }, 1200);
        });
    }

    function attachMessageListener() {
        if (state.messageListenerAttached) {
            return;
        }

        state.messageListenerAttached = true;

        window.addEventListener('message', function (event) {
            var data = event.data;
            if (!data || typeof data !== 'object') {
                return;
            }

            if (data.type === 'anycac-payment-redirect') {
                savePaymentState({
                    returnUrl: data.returnUrl || '',
                    timestamp: Date.now(),
                    originalUrl: window.location.href
                });
                emit('payment.redirect', data);
                window.location.href = data.url;
                return;
            }

            if (data.type === 'anycac-payment-complete') {
                clearPaymentState();
                emit('payment.complete', data.order || {});
                if (state.currentView === 'checkout') {
                    redirectToReturn(data.order || {});
                }
                return;
            }

            if (data.type === 'anycac-response') {
                emit('transport.response', data);
                if (data.command === 'add-to-cart') {
                    if (data.success) {
                        emit('cart.added', data.data || {});
                    } else {
                        emit('cart.error', data.error || 'Failed to add to cart');
                    }
                }
                return;
            }

            if (data.type === 'anycac-frame-height') {
                syncFrameHeightFromMessage(event, data);
            }
        });
    }

    function resolveContainerElement(target, routeName) {
        if (target) {
            if (typeof target === 'string') {
                return document.querySelector(target);
            }
            return target;
        }

        var routeConfig = state.config.routes[routeName] || {};
        if (routeConfig.container && typeof routeConfig.container === 'string') {
            return document.querySelector(routeConfig.container);
        }

        return document.body;
    }

    function ensureManagedIframe(container, routeName) {
        if (!container) {
            throw new Error('AnyCac route container not found: ' + routeName);
        }

        if (container.tagName && container.tagName.toLowerCase() === 'iframe') {
            container.setAttribute('scrolling', 'no');
            bindFrameAutoResize(container);
            return container;
        }

        var iframe = container.querySelector('iframe[data-anycac-route="' + routeName + '"]');
        if (!iframe) {
            iframe = document.createElement('iframe');
            iframe.setAttribute('data-anycac-route', routeName);
            iframe.style.width = '100%';
            iframe.style.height = '100%';
            iframe.style.minHeight = '100vh';
            iframe.style.border = 'none';
            iframe.style.display = 'block';
            iframe.setAttribute('scrolling', 'no');
            container.appendChild(iframe);
        }

        bindFrameAutoResize(iframe);

        return iframe;
    }

    function resolveRouteFrame(routeName, target) {
        var container = resolveContainerElement(target, routeName);
        return ensureManagedIframe(container, routeName);
    }

    function buildForwardSrc(currentUrl) {
        var params = new URLSearchParams(currentUrl.search);
        params.set('anycac_iframe_forward', '1');
        return getPaymentStoreBase() + '/?' + params.toString();
    }

    function mountCart(target) {
        state.currentView = 'cart';
        var frame = resolveRouteFrame('cart', target);
        frame.src = getPaymentStoreBase() + '/cart/';
    }

    function mountCheckout(target) {
        state.currentView = 'checkout';
        var frame = resolveRouteFrame('checkout', target);
        var currentUrl = new URL(window.location.href);

        var orderId = currentUrl.searchParams.get('anycac_order_id');
        var orderKey = currentUrl.searchParams.get('anycac_order_key');
        var status = currentUrl.searchParams.get('anycac_status');

        if (orderId && orderKey) {
            redirectToReturn({ order_id: orderId, order_key: orderKey, status: status || '' });
            return;
        }

        if (isSuccessfulReturn(currentUrl)) {
            var returnUrl = routeToUrl('return');
            returnUrl.search = currentUrl.search;
            window.location.replace(returnUrl.toString());
            return;
        }

        if (!hasRelayParams(currentUrl)) {
            frame.src = getPaymentStoreBase() + '/checkout/';
            return;
        }

        frame.src = buildForwardSrc(currentUrl);
        var cleanUrl = currentUrl.origin + currentUrl.pathname;
        window.history.replaceState({}, document.title, cleanUrl);
    }

    function mountReturn(target) {
        state.currentView = 'return';
        var frame = resolveRouteFrame('return', target);
        var currentUrl = new URL(window.location.href);

        var orderId = currentUrl.searchParams.get('order_id') || currentUrl.searchParams.get('anycac_order_id');
        var orderKey = currentUrl.searchParams.get('order_key') || currentUrl.searchParams.get('key') || currentUrl.searchParams.get('anycac_order_key');

        if (hasPayPalCancel(currentUrl) || hasStripeReturnCancel(currentUrl)) {
            var checkoutUrl = routeToUrl('checkout');
            checkoutUrl.search = currentUrl.search;
            window.location.replace(checkoutUrl.toString());
            return;
        }

        if (orderId && orderKey) {
            var orderReceivedUrl = new URL('/checkout/order-received/' + encodeURIComponent(orderId) + '/', getPaymentStoreBase() + '/');
            orderReceivedUrl.searchParams.set('key', orderKey);
            frame.src = orderReceivedUrl.toString();
            return;
        }

        if (hasRelayParams(currentUrl)) {
            frame.src = buildForwardSrc(currentUrl);
            return;
        }

        frame.src = getPaymentStoreBase() + '/checkout/';
    }

    function mountCurrentRoute() {
        var routeName = getCurrentRouteName();
        if (!routeName) {
            return false;
        }

        if (routeName === 'cart') {
            mountCart();
            return true;
        }
        if (routeName === 'checkout') {
            mountCheckout();
            return true;
        }
        if (routeName === 'return') {
            mountReturn();
            return true;
        }

        return false;
    }

    function routePaymentCallbacks() {
        var currentUrl = new URL(window.location.href);
        if (!hasRelayParams(currentUrl)) {
            return false;
        }

        var currentRoute = getCurrentRouteName();
        if (currentRoute === 'checkout' || currentRoute === 'return') {
            return false;
        }

        var destination = routeToUrl(isSuccessfulReturn(currentUrl) ? 'return' : 'checkout');
        destination.search = currentUrl.search;
        window.location.replace(destination.toString());
        return true;
    }

    function ensureModal() {
        if (state.modal) {
            return state.modal;
        }

        var overlay = document.createElement('div');
        overlay.style.position = 'fixed';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.right = '0';
        overlay.style.bottom = '0';
        overlay.style.background = 'rgba(0, 0, 0, 0.45)';
        overlay.style.opacity = '0';
        overlay.style.pointerEvents = 'none';
        overlay.style.transition = 'opacity 180ms ease';
        overlay.style.zIndex = '99999';

        var panel = document.createElement('div');
        panel.style.position = 'absolute';
        panel.style.top = '0';
        panel.style.right = '0';
        panel.style.width = 'min(560px, 96vw)';
        panel.style.height = '100%';
        panel.style.background = '#fff';
        panel.style.borderRadius = '12px 0 0 12px';
        panel.style.overflow = 'hidden';
        panel.style.boxShadow = '-12px 0 32px rgba(0, 0, 0, 0.18)';
        panel.style.display = 'flex';
        panel.style.flexDirection = 'column';
        panel.style.transform = 'translateX(100%)';
        panel.style.transition = 'transform 220ms ease';

        var header = document.createElement('div');
        header.style.height = '52px';
        header.style.padding = '0 16px';
        header.style.display = 'flex';
        header.style.alignItems = 'center';
        header.style.justifyContent = 'space-between';
        header.style.borderBottom = '1px solid #e5e5e5';

        var title = document.createElement('div');
        title.textContent = 'Your Cart';
        title.style.fontFamily = '-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif';
        title.style.fontWeight = '600';
        title.style.fontSize = '15px';
        title.style.color = '#111';

        var closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.textContent = 'Close';
        closeBtn.style.border = 'none';
        closeBtn.style.background = '#111';
        closeBtn.style.color = '#fff';
        closeBtn.style.borderRadius = '8px';
        closeBtn.style.padding = '8px 12px';
        closeBtn.style.cursor = 'pointer';
        closeBtn.style.fontSize = '13px';

        var iframe = document.createElement('iframe');
        iframe.style.flex = '1';
        iframe.style.width = '100%';
        iframe.style.border = 'none';
        iframe.setAttribute('title', 'AnyCac Modal');


        header.appendChild(title);
        header.appendChild(closeBtn);
        panel.appendChild(header);
        panel.appendChild(iframe);
        overlay.appendChild(panel);
        document.body.appendChild(overlay);

        overlay.addEventListener('click', function (event) {
            if (event.target === overlay) {
                closeModal();
            }
        });
        closeBtn.addEventListener('click', closeModal);

        state.modal = {
            overlay: overlay,
            panel: panel,
            title: title,
            iframe: iframe
        };

        return state.modal;
    }

    function openModal(url, title) {
        var modal = ensureModal();
        modal.title.textContent = title || 'AnyCac';
        modal.overlay.style.opacity = '1';
        modal.overlay.style.pointerEvents = 'auto';
        modal.panel.style.transform = 'translateX(0)';

        if (modal.iframe.src !== url) {
            modal.iframe.dataset.anycacLoaded = '0';
            modal.iframe.onload = function () {
                modal.iframe.dataset.anycacLoaded = '1';
            };
            modal.iframe.src = url;
        }

        emit('modal.opened', { url: url, title: title || '' });
    }

    function closeModal() {
        if (!state.modal) {
            return;
        }
        state.modal.overlay.style.opacity = '0';
        state.modal.overlay.style.pointerEvents = 'none';
        state.modal.panel.style.transform = 'translateX(100%)';
        emit('modal.closed', null);
    }

    function openCartModal() {
        openModal(getPaymentStoreBase() + '/cart/', 'Your Cart');
    }

    function openCartSlider() {
        openCartModal();
    }

    function sendCommandToModal(command, payload) {
        var modal = ensureModal();
        var message = { command: command, payload: payload };

        var send = function () {
            if (modal.iframe.contentWindow) {
                modal.iframe.contentWindow.postMessage(message, '*');
            }
        };

        if (modal.iframe.dataset.anycacLoaded === '1') {
            send();
            return;
        }

        var onLoad = function () {
            send();
            modal.iframe.removeEventListener('load', onLoad);
        };
        modal.iframe.addEventListener('load', onLoad);
    }

    function addToCart(payload, options) {
        var nextOptions = options || {};
        if (nextOptions.openModal !== false && nextOptions.openSlider !== false) {
            openCartModal();
        }
        sendCommandToModal('add-to-cart', payload);
    }

    function init(config) {
        state.config = mergeConfig(config);
        applyPreconnectHints();
        attachMessageListener();

        if (state.config.autoRouteCallbacks && routePaymentCallbacks()) {
            return api;
        }

        state.currentView = getCurrentRouteName();

        if (state.config.autoMount) {
            mountCurrentRoute();
        }

        bindCartTrigger(state.config.cartTrigger);

        return api;
    }

    var api = {
        version: SDK_VERSION,
        init: init,
        on: on,
        off: off,
        addToCart: addToCart,
        openCartSlider: openCartSlider,
        openCartModal: openCartModal,
        openModal: openModal,
        closeModal: closeModal,
        routePaymentCallbacks: routePaymentCallbacks,
        mountCart: mountCart,
        mountCheckout: mountCheckout,
        mountReturn: mountReturn,
        mountThankYou: mountReturn,
        mountCurrentRoute: mountCurrentRoute,
        bindCartTrigger: bindCartTrigger
    };

    global.AnyCac = api;

    recoverCallbackBeforeInit();
})(window);
