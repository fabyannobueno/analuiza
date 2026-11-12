---
name: Ana Luiza Lash Firebase scope
description: User-mandated frontend-only Firebase architecture and profile-photo storage format.
---

For Ana Luiza Lash, do not use Cloud Functions or Firebase Storage. Keep application access in the frontend with Firebase SDK. Do not upload files; profile photos must be resized to 500×500 and stored as base64 in Firestore.

**Why:** the user explicitly specified this architecture and photo format.

**How to apply:** enforce data access with Firestore Security Rules tied to authenticated user identity. Compress profile photos so the Firestore document remains below its 1 MiB limit. Ask before changing this architecture if a requested feature cannot be secured within it.
