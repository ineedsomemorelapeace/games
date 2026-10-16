# Convex backend migration

This branch points the static frontend at the Convex HTTP deployment configured in `assets/backend-client.js`.

## Deploy

From a clone of this branch, run:

```sh
npm install
npx convex dev --once
npm run convex:deploy
```

Sign in to the Convex account that owns the existing `carson-games` project when prompted. Confirm the deployment target is the project whose HTTP actions URL is `https://shiny-ermine-774.convex.site`. Do not create a new project. The first command generates the local Convex API bindings; the deploy command publishes the current functions and schema.

## Routes migrated

- Account creation, sign-in, session lookup, sign-out, and password update
- Compatibility database reads/writes for app-specific collections
- Polling events and broadcasts
- Authenticated file upload/list/remove and public file reads
- Blackjack match creation, polling, hit/stand/rematch/leave actions

## Important limitations

This is a compatibility migration, not a full redesign of the data model. The generic database adapter intentionally excludes the `users` collection and currently caps a query to 500 records before filtering. Existing Heroku/Postgres data is not automatically copied into Convex; accounts and records from the old backend will not appear in Convex unless migrated separately. Keep the old backend/data until you have verified the new deployment and migrated any data you need.

After deployment, open `https://shiny-ermine-774.convex.site/api/health` and confirm it returns `{"ok":true,"backend":"convex"}`. Then test sign-up/sign-in, chat messages, uploads, and a two-browser Blackjack match before merging the pull request.
