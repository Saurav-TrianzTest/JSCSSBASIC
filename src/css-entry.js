/**
 * CSS Bundle Entry Point — GCP Cloud Build / Webpack CSS Bundling
 * ================================================================
 * CLOUD READINESS FIX (cr-css-1006): Multiple CSS Files Not Concatenated or HTTP/2
 *
 * This file is the webpack entry point that imports all CSS chunk files,
 * deferred.css, site.css, and brand.css so that MiniCssExtractPlugin can
 * concatenate them into a single output bundle: dist/css/bundle.css.
 *
 * Previously, loader.css used 13 individual @import statements which created
 * excessive HTTP requests. Webpack processes this entry file and emits a single
 * concatenated CSS bundle, eliminating all per-chunk HTTP request overhead.
 *
 * GCP Cloud Build uploads dist/css/bundle.css to Cloud Storage, served via
 * Cloud CDN with HTTP/2 for optimal edge network performance.
 *
 * To add new CSS modules to the bundle, import them here and register them
 * in webpack.config.js.
 */

/* Chunk files — previously loaded via @import in loader.css */
import './assets/css/chunks/chunk00.css';
import './assets/css/chunks/chunk01.css';
import './assets/css/chunks/chunk02.css';
import './assets/css/chunks/chunk03.css';
import './assets/css/chunks/chunk04.css';
import './assets/css/chunks/chunk05.css';
import './assets/css/chunks/chunk06.css';
import './assets/css/chunks/chunk07.css';
import './assets/css/chunks/chunk08.css';
import './assets/css/chunks/chunk09.css';

/* Deferred widget styles */
import './assets/css/deferred.css';

/* Main site stylesheet */
import './assets/css/site.css';

/* Brand / theme overrides */
import './assets/css/brand.css';
