# jaili-backend-interview-assessment
Project Interview for JALI Finance

## Database initialization

The initial MySQL schema is in `database/init/001_schema.sql`. The `db`
service in `docker-compose.yml` mounts this directory read-only at
`/docker-entrypoint-initdb.d`, which the MySQL 8.4 image processes when it
initializes an empty data directory. Configure `.env` with `DB_NAME`,
`DB_USER`, `DB_PASSWORD`, and `MYSQL_ROOT_PASSWORD`, then start the services
with `docker compose up`.

The schema creates the loans, payments, loan ledger, loan events, and callback
events tables. A provider/transaction pair is unique for payments, and a
payment may be applied to the ledger only once. Repeated callback notifications
are retained as separate callback events.

**Existing MySQL volume:** initialization scripts run only when the MySQL data
directory is empty. Restarting with an existing `mysql_data` volume does not
run this script. Do not delete the volume to force initialization; that would
destroy its data. After reviewing and backing up the target database, apply
the schema explicitly to it, for example:

```sh
docker compose exec -T db sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' < database/init/001_schema.sql
```

`CREATE TABLE IF NOT EXISTS` makes this script suitable for creating missing
tables but does not update an existing table to a newer definition; use a
reviewed migration for schema changes.
