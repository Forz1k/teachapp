# Web Push crypto LAB (7.3)

Isolated encryption rehearsal using Web Crypto P-256 ECDH, HKDF-SHA-256 and AES-128-GCM. Single aes128gcm record, fresh ephemeral key and salt, fixed generic signal, 4096-byte total-body bound. RFC 8291 sections 3–5 and RFC 8188: https://www.rfc-editor.org/rfc/rfc8291.html and https://www.rfc-editor.org/rfc/rfc8188.html. The deterministic vector helper is test-only; never reuse a sender key/salt in real delivery. Public RFC example keys are not deployment credentials.

Tests verify the complete public known-answer vector byte for byte, independent receiver decryption, fresh randomness, malformed keys and authentication failure. No endpoint, fetch, subscription storage, VAPID authorization, retries, service-worker listener or actual send is implemented. LAB is not deployed. A real sender requires reviewed key management, endpoint/egress validation, consent and revocation, delivery semantics and physical device acceptance.

The Section 5 base64url body decodes to 144 bytes, although its illustrative Content-Length is 145. The test compares every byte to the published body and checks the actual decoded length, not that illustrative header.
