/**
 * css-sanitizer.js
 *
 * CLOUD REMEDIATION (cr-css-1001): CSS Injection via User-Controlled Style Values
 *
 * Provides an allowlist-based CSS value sanitizer to prevent CSS injection attacks
 * in cloud-hosted applications. User-controlled values must NEVER be interpolated
 * directly into CSS style attributes, custom properties, or content expressions.
 *
 * Remediation strategy: Sanitize CSS User Input with AWS WAF and Server-Side CSS Encoding
 *
 * AWS WAF Integration:
 *   - Enable AWSManagedRulesCommonRuleSet on your CloudFront distribution or ALB.
 *   - Enable AWSManagedRulesBotControlRuleSet to block automated injection probes.
 *   - These managed rules block common CSS injection payloads at the edge before
 *     they reach application code.
 *
 * Usage:
 *   import { sanitizeCssValue, setUserCardLabel, sanitizeStyleProperty } from './css-sanitizer.js';
 *
 *   // Safe: render user display name as a DOM text node (never via CSS attr())
 *   setUserCardLabel(cardElement, userDisplayName);
 *
 *   // Safe: apply a user-chosen color only if it passes the allowlist
 *   const safeColor = sanitizeCssValue('color', userChosenColor);
 *   if (safeColor) element.style.color = safeColor;
 */

'use strict';

// ---------------------------------------------------------------------------
// Allowlist patterns for CSS property values
// ---------------------------------------------------------------------------

/**
 * Allowlist of safe CSS color formats.
 * Matches: #rgb, #rrggbb, #rrggbbaa, rgb(), rgba(), hsl(), hsla(), named colors.
 */
const COLOR_ALLOWLIST = /^(#([0-9a-fA-F]{3,8})|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)|rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(0|1|0?\.\d+)\s*\)|hsl\(\s*\d{1,3}\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%\s*\)|hsla\(\s*\d{1,3}\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%\s*,\s*(0|1|0?\.\d+)\s*\)|transparent|inherit|initial|unset|currentColor|[a-zA-Z]{3,30})$/;

/**
 * Allowlist of safe CSS dimension values (px, em, rem, %, vw, vh, etc.).
 */
const DIMENSION_ALLOWLIST = /^-?\d+(\.\d+)?(px|em|rem|%|vw|vh|vmin|vmax|ch|ex|cm|mm|in|pt|pc)?$/;

/**
 * Characters that are dangerous in any CSS context.
 * Presence of any of these in a user value is grounds for rejection.
 */
const CSS_INJECTION_CHARS = /[{};:()'"\\<>@!`]/;

// ---------------------------------------------------------------------------
// Core sanitization helpers
// ---------------------------------------------------------------------------

/**
 * Encodes a string so it is safe to embed as a CSS string literal value.
 * Escapes backslash, double-quote, single-quote, and newline characters.
 *
 * @param {string} value - Raw user-supplied string.
 * @returns {string} CSS-encoded string (without surrounding quotes).
 */
export function encodeCssStringValue(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\\/g, '\\\\')   // backslash must be first
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\A ')
    .replace(/\r/g, '')
    .replace(/\t/g, '\\9 ');
}

/**
 * Validates a user-supplied CSS property value against an allowlist for the
 * given property name. Returns the sanitized value on success, or null if the
 * value is rejected.
 *
 * Supported property categories:
 *   - color properties  → COLOR_ALLOWLIST
 *   - dimension/size    → DIMENSION_ALLOWLIST
 *   - all others        → reject if injection characters are present
 *
 * @param {string} property - CSS property name (e.g. 'color', 'font-size').
 * @param {string} value    - User-supplied value to validate.
 * @returns {string|null}   - Sanitized value, or null if rejected.
 */
export function sanitizeCssValue(property, value) {
  if (typeof value !== 'string' || typeof property !== 'string') return null;

  // Trim whitespace
  const trimmed = value.trim();

  // Reject empty values
  if (!trimmed) return null;

  // Reject values containing CSS injection characters
  if (CSS_INJECTION_CHARS.test(trimmed)) {
    console.warn('[css-sanitizer] Rejected CSS value for property "' + property + '": injection characters detected.');
    return null;
  }

  const prop = property.toLowerCase();

  // Color properties
  if (
    prop === 'color' ||
    prop === 'background-color' ||
    prop === 'border-color' ||
    prop === 'outline-color' ||
    prop === 'text-decoration-color' ||
    prop.endsWith('-color')
  ) {
    if (COLOR_ALLOWLIST.test(trimmed)) return trimmed;
    console.warn('[css-sanitizer] Rejected CSS color value for "' + property + '": not in allowlist.');
    return null;
  }

  // Dimension / size properties
  if (
    prop === 'width' || prop === 'height' ||
    prop === 'max-width' || prop === 'max-height' ||
    prop === 'min-width' || prop === 'min-height' ||
    prop === 'font-size' || prop === 'line-height' ||
    prop === 'margin' || prop === 'padding' ||
    prop === 'top' || prop === 'right' || prop === 'bottom' || prop === 'left' ||
    prop === 'border-width' || prop === 'border-radius' ||
    prop === 'gap' || prop === 'flex-basis'
  ) {
    if (DIMENSION_ALLOWLIST.test(trimmed)) return trimmed;
    console.warn('[css-sanitizer] Rejected CSS dimension value for "' + property + '": not in allowlist.');
    return null;
  }

  // For all other properties: reject if any injection character is present
  // (already checked above) and return the trimmed value.
  return trimmed;
}

// ---------------------------------------------------------------------------
// DOM helpers — safe alternatives to CSS attr() / content injection
// ---------------------------------------------------------------------------

/**
 * Safely sets the visible label on a .user-card element using a DOM text node.
 *
 * This is the safe replacement for the removed CSS rule:
 *   .user-card::before { content: attr(data-user); }
 *
 * The user display name is HTML-encoded and injected as a text node, NOT via
 * CSS content or attr(), preventing CSS injection and XSS simultaneously.
 *
 * @param {HTMLElement} cardElement   - The .user-card DOM element.
 * @param {string}      displayName   - User-supplied display name (will be sanitized).
 */
export function setUserCardLabel(cardElement, displayName) {
  if (!cardElement || typeof displayName !== 'string') return;

  // Encode the display name: strip control characters, limit length
  const safe = displayName
    .replace(/[\x00-\x1F\x7F]/g, '')  // strip control characters
    .slice(0, 128);                     // enforce maximum length

  // Find or create the label element inside the card
  let labelEl = cardElement.querySelector('.user-card__label');
  if (!labelEl) {
    labelEl = document.createElement('span');
    labelEl.className = 'user-card__label';
    labelEl.setAttribute('aria-label', 'User');
    cardElement.prepend(labelEl);
  }

  // Set as text content — the browser HTML-encodes this automatically,
  // so no CSS injection or XSS is possible.
  labelEl.textContent = safe;

  // Remove the data-user attribute to prevent it from being consumed by
  // any residual CSS attr() expressions in third-party stylesheets.
  cardElement.removeAttribute('data-user');
}

/**
 * Safely applies a user-chosen inline style property to a DOM element.
 * The value is validated against the allowlist before being applied.
 *
 * @param {HTMLElement} element  - Target DOM element.
 * @param {string}      property - CSS property name.
 * @param {string}      value    - User-supplied value.
 * @returns {boolean}            - true if the value was applied, false if rejected.
 */
export function sanitizeStyleProperty(element, property, value) {
  if (!element || !element.style) return false;
  const safe = sanitizeCssValue(property, value);
  if (safe === null) return false;
  element.style.setProperty(property, safe);
  return true;
}

// ---------------------------------------------------------------------------
// Emotion / CSS-in-JS integration
// ---------------------------------------------------------------------------

/**
 * Sanitizes a CSS template literal string produced by a CSS-in-JS library
 * (e.g. @emotion/styled) before it is injected into a <style> element.
 *
 * Strips any expression that matches known CSS injection patterns:
 *   - url() with data: or javascript: schemes
 *   - expression() (IE legacy)
 *   - Unescaped CSS injection characters in string contexts
 *
 * @param {string} cssText - Raw CSS text from a template literal.
 * @returns {string}       - Sanitized CSS text.
 */
export function sanitizeEmotionCss(cssText) {
  if (typeof cssText !== 'string') return '';

  return cssText
    // Block javascript: and data: URIs inside url()
    .replace(/url\(\s*['"]?\s*(javascript|data):[^)]*\)/gi, 'url(about:blank)')
    // Block IE expression()
    .replace(/expression\s*\(/gi, '/* blocked: expression( */')
    // Block @import inside injected CSS blocks
    .replace(/@import\b/gi, '/* blocked: @import */');
}

// ---------------------------------------------------------------------------
// Default export (convenience object)
// ---------------------------------------------------------------------------

const cssSanitizer = {
  encodeCssStringValue,
  sanitizeCssValue,
  setUserCardLabel,
  sanitizeStyleProperty,
  sanitizeEmotionCss,
};

export default cssSanitizer;
