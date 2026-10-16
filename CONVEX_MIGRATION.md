# CarsonGames → Convex migration

This is a staged migration for the existing plain HTML/CSS/JavaScript site hosted on GitHub Pages.

## Important: current backend is not removed yet

The existing frontend calls the Supabase-compatible adapter at `assets/backend-client.js`, which currently points to the Heroku Express/PostgreSQL service. Many pages rely on its auth, generic database queries, storage, broadcasts/realtime polling, and the Blackjack endpoints. Removing the Heroku backend before replacing all of those would break existing features.

The migration branch adds the initial Convex schema. Keep the current backend active until the compatibility adapter and all features have been migrated and tested. UI and page logic should remain unchanged; the intended change is the backend implementation behind the existing adapter.

## Setup

1. Create/sign in to a Convex account: https://dashboard.convex.dev/
2. Install Node.js 20+ and clone this repository locally, or open it in GitHub Codespaces.
3. From the repository root, run:

   ```sh
   npm install convex
   npx convex dev
   ```

4. Follow the CLI prompts to create/link a Convex project. This generates `.env.local` and the `convex/_generated` files. Do not commit `.env.local` or deployment secrets.
5. The schema in `convex/schema.ts` will be deployed automatically by `npx convex dev`.

## Migration phases

1. **Schema and project setup** — this branch.
2. Implement validated Convex functions for auth/session management, user profiles, generic collection CRUD, announcements, storage, and realtime events.
3. Replace the internals of `assets/backend-client.js` with a Convex-backed compatibility adapter. Keep the existing public methods and response shapes so page UI and business logic do not need to change.
4. Migrate Blackjack endpoints to Convex functions while preserving server-authoritative game rules.
5. Test login/signup, profiles, moderation, messages/whispers, voice-room signaling, file uploads, announcements, and Blackjack.
6. Only after all tests pass, remove the Express/PostgreSQL server, Heroku URL, `Procfile`, and old backend dependencies.

## Data and security notes

- Existing PostgreSQL data is not copied automatically by this schema.
- Password hashes and session token hashes must only be read or written by protected server-side functions; never return them to the browser.
- Convex IDs differ from the old UUID IDs, so the compatibility layer should retain explicit `externalId` values where the existing frontend expects string IDs.
- Browser-facing functions must validate the session and permissions server-side. Do not trust a role supplied by the client.
