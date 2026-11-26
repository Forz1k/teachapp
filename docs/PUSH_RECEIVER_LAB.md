# Push receiver LAB

A service-worker-shaped handler for a fixed decrypted generic signal (version 1, workspace-update). Only an isolated localhost scope ending in /tools/prototypes/push-receiver/ is accepted. The caller must provide an explicit consent reader, default denied. Displays only a constant title/body/tag; no data or link from the received message. Click closes only this tag and focuses the exact local test window, or opens a fixed local index.html, with consent rechecked after client lookup.

Unit tests use synthetic events and mock registration/clients. Nothing registers this handler in the main application or a real service worker, creates a subscription, or receives an actual push. A later isolated browser fixture and physical device acceptance are required. Already displayed OS notifications cannot be retracted by a consent check.
