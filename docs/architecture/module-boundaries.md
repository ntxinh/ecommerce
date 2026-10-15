# Module Boundaries

**Status: Implemented (layout); most modules Planned**

Domain modules live in `src/server/modules/<module>/`. Present today:
`identity` (register/login/reset/verify services). The remaining modules are
created as their phases land.

| Module | Owns | Status |
|---|---|---|
| `identity` | users, roles, sessions use-cases, password reset/verify | Implemented |
| `profiles` | customer profiles, addresses | Planned |
| `sellers` | shops, memberships, seller applications | Implemented |
| `catalog` | categories, brands, products, variants, images, moderation | Planned |
| `inventory` | stock levels, movements, reservations | Planned |
| `search` | product search/filters | Planned |
| `cart` | carts, wishlists, merge | Implemented |
| `pricing` | promotions, vouchers, `priceOrder` | Implemented |
| `orders` | orders, seller_orders, items, transitions | Planned |
| `payments` | payments, attempts, refunds, adapters | Planned |
| `shipping` | shipments, tracking, providers | Planned |
| `reviews` | reviews, moderation | Planned |
| `notifications` | notifications, preferences | Planned |
| `finance` | ledger, settlements | Planned |
| `admin` | admin console operations | Planned |
| `audit` | audit_logs | Planned |

## Boundary rules

1. Services call other modules' **exported service functions only** — never
   another module's repository or schema internals.
2. `import "server-only";` is the first line of every `src/server/**` file.
3. Money is integer minor units (whole đồng), columns suffixed `_vnd`;
   timestamps are integer unixepoch **milliseconds** (`Date.now()`-native),
   suffixed `_at`; ids are text ULIDs.
4. Route handlers stay thin: parse → authorize → delegate → serialize.
