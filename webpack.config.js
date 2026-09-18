/**
 * webpack.config.js — CSS Bundle Configuration for GCP Cloud Build
 * =================================================================
 * CLOUD READINESS FIX (cr-css-1006): Multiple CSS Files Not Concatenated or HTTP/2
 *
 * This webpack configuration concatenates all CSS chunk files, deferred.css,
 * site.css, and brand.css into a single output bundle (dist/css/bundle.css)
 * using MiniCssExtractPlugin.
 *
 * GCP Cloud Build runs `npm run build:bundle` (this webpack config) as a build
 * step, then uploads dist/css/bundle.css to GCP Cloud Storage
 * (gs://${_GCP_ASSETS_BUCKET}/css/bundle.css), served via Cloud CDN with HTTP/2.
 *
 * Cloud Build step snippet (add to cloudbuild.yaml):
 *   steps:
 *     - name: 'node:20'
 *       entrypoint: npm
 *       args: ['ci']
 *     - name: 'node:20'
 *       entrypoint: npm
 *       args: ['run', 'build:bundle']
 *     - name: 'gcr.io/cloud-builders/gsutil'
 *       args: ['-m', 'cp', '-r', 'dist/css/*',
 *              'gs://${_GCP_ASSETS_BUCKET}/css/']
 *
 * Environment variables (set in Cloud Build trigger or .env for local dev):
 *   GCP_CDN_BASE_URL  — Cloud CDN / Cloud Storage base URL for asset references
 *                       e.g. https://storage.googleapis.com/my-bucket
 *   NODE_ENV          — 'production' for minified output, 'development' otherwise
 */

'use strict';

const path = require('path');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CssMinimizerPlugin = require('css-minimizer-webpack-plugin');
const webpack = require('webpack');

const isProduction = process.env.NODE_ENV === 'production';

// GCP Cloud CDN / Cloud Storage base URL injected at build time.
// Set GCP_CDN_BASE_URL in Cloud Build substitution variables or local .env.
// Example: https://storage.googleapis.com/my-gcp-assets-bucket
const gcpCdnBaseUrl = process.env.GCP_CDN_BASE_URL || '';

module.exports = {
  /**
   * Mode: 'production' enables minification and tree-shaking.
   * Cloud Build sets NODE_ENV=production before running this step.
   */
  mode: isProduction ? 'production' : 'development',

  /**
   * Entry: the CSS bundle entry point that imports all chunk files.
   * Previously these were loaded via @import in loader.css (13 separate HTTP
   * requests). Webpack concatenates them into a single bundle.
   */
  entry: {
    bundle: './src/css-entry.js'
  },

  /**
   * Output: emit the JS shim to dist/js/ (discarded — only the CSS matters).
   * MiniCssExtractPlugin writes the concatenated CSS to dist/css/bundle.css.
   */
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'js/[name].shim.js',
    clean: false
  },

  module: {
    rules: [
      {
        /**
         * CSS rule: process all .css files through css-loader (resolves @import
         * and url() references) then extract to a single file via
         * MiniCssExtractPlugin. This replaces the browser-side @import chain
         * in loader.css with a single concatenated HTTP request.
         */
        test: /\.css$/i,
        use: [
          MiniCssExtractPlugin.loader,
          {
            loader: 'css-loader',
            options: {
              /**
               * importLoaders: 0 — no additional loaders run before css-loader
               * for @import-ed files (all CSS is plain CSS, no preprocessors).
               */
              importLoaders: 0,
              /**
               * url: false — do NOT rewrite url() references in CSS.
               * Asset URLs are managed separately (GCP Cloud CDN substitution
               * via __GCP_CDN_BASE_URL__ replaced by DefinePlugin below).
               */
              url: false
            }
          }
        ]
      }
    ]
  },

  plugins: [
    /**
     * MiniCssExtractPlugin: extracts all CSS imported via src/css-entry.js
     * into a single concatenated file at dist/css/bundle.css.
     * GCP Cloud Build uploads this file to Cloud Storage / Cloud CDN.
     */
    new MiniCssExtractPlugin({
      filename: 'css/bundle.css'
    }),

    /**
     * DefinePlugin: substitutes __GCP_CDN_BASE_URL__ in CSS url() values
     * with the actual GCP Cloud CDN / Cloud Storage base URL at build time.
     * Set GCP_CDN_BASE_URL in Cloud Build substitution variables.
     */
    new webpack.DefinePlugin({
      __GCP_CDN_BASE_URL__: JSON.stringify(gcpCdnBaseUrl)
    })
  ],

  optimization: {
    /**
     * CssMinimizerPlugin: minifies the concatenated CSS bundle in production.
     * Reduces bundle size served from GCP Cloud Storage / Cloud CDN.
     */
    minimizer: [
      '...',
      new CssMinimizerPlugin()
    ]
  },

  /**
   * Resolve: allow importing CSS files without specifying the extension.
   */
  resolve: {
    extensions: ['.js', '.css']
  }
};
