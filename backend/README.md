# CarsonGames backend

This service serves the static site and provides the same-origin Node/PostgreSQL API used by the pages outside `play/`.

On Heroku, add Heroku Postgres and set `JWT_SECRET` to a long random value. Initialize the database once with `schema.sql`, then deploy from the repository root. The `DATABASE_URL` and `PORT` values are supplied by Heroku.