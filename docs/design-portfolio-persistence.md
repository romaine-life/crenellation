# Design Portfolio Persistence

The design portfolio review UI persists draft decisions through:

- `GET /api/design-portfolios/:id`
- `PUT /api/design-portfolios/:id`

For the main menu acceptance ledger, the id is `main-menu-acceptance`.

## Persistence Model

The endpoint stores one opaque JSON document per portfolio id. The server only
requires the top-level request body to include a `data` object:

```json
{
  "client_schema_version": 1,
  "metadata": {
    "route": "/design/main-menu",
    "source": "visual-acceptance-ledger"
  },
  "data": {
    "kind": "main-menu-acceptance-ledger",
    "document_version": 1,
    "review_statuses": {
      "profile-chrome": "accepted"
    }
  }
}
```

Unknown fields inside `data` and `metadata` are preserved. This is deliberate:
portfolio review payloads are expected to change while design work is moving,
and those changes should not require production database migrations.

## Storage

The current implementation writes a versioned JSON store file at
`DESIGN_PORTFOLIO_STORE_PATH`. If unset, it defaults to a file in the writable
hot backend directory, then the static override directory, then the runtime
directory, and finally `/tmp`. That makes draft values survive backend reloads
in a running test slot without committing them to git.

The committed source of truth remains the markdown acceptance profile. A draft
decision becomes durable project policy only when the relevant profile document
is updated and committed.
