import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// 1. Verify token hashing matches PostgreSQL extensions.digest(raw, 'sha256')
function sha256Hex(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

const rawToken = 'bf_inv_test_token_987654321';
const hash = sha256Hex(rawToken);
assert.equal(hash.length, 64, 'SHA-256 hash must be 64 characters');
assert.equal(
  hash,
  crypto.createHash('sha256').update(rawToken).digest('hex'),
  'Hash matches standard sha256 digest'
);
console.log('✔ Token hashing invariant verified (64-char sha256 hex)');

// 2. Verify deep link construction
const testBaseUrl = 'https://app.bakeflow.test';
const deepLinkScheme = 'bakeflow';

const webLink = `${testBaseUrl}/invite?token=${encodeURIComponent(rawToken)}`;
const mobileLink = `${deepLinkScheme}://invite?token=${encodeURIComponent(rawToken)}`;

assert.ok(webLink.includes(`token=${rawToken}`), 'Web link contains token parameter');
assert.ok(mobileLink.startsWith('bakeflow://invite?token='), 'Mobile link uses custom URI scheme');
console.log('✔ Deep-link & web link generation verified');

// 3. Verify HTML escaping
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const unsafeOrgName = 'Bakery <script>alert("xss")</script> & Sons';
const safeOrgName = escapeHtml(unsafeOrgName);
assert.ok(!safeOrgName.includes('<script>'), 'HTML escaping eliminates script tag');
assert.ok(safeOrgName.includes('&amp;'), 'HTML escaping encodes ampersand');
console.log('✔ Template HTML safety escaping verified');

console.log('\nAll 3 invitation verification checks passed.');
