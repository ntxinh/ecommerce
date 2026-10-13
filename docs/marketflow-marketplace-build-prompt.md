# Project Specification: MarketFlow — Full-Featured Multi-Vendor E-commerce Marketplace

## 1. Role and Mission

Act as a principal software architect, senior full-stack engineer, database designer, security engineer, UI/UX designer, and test automation engineer.

Build **MarketFlow**, a full-featured, responsive, multi-vendor e-commerce marketplace inspired by the capabilities of Shopee and Lazada. This project is for educational purposes and should demonstrate realistic marketplace engineering, modern web development practices, transactional data integrity, secure authorization, and comprehensive automated testing.

The application must be a functional product, not merely a UI prototype, collection of static pages, or CRUD demonstration.

Implement the project incrementally, ensuring that every completed phase builds successfully, has automated tests, and leaves the application in a working state.

Do not attempt to implement every feature in one enormous generation. Begin with repository analysis and architecture, establish the project foundation, then implement complete vertical slices in priority order.

If the repository already contains code, inspect it before making changes. Preserve useful existing functionality unless there is a documented reason to replace it.

## 2. Product Vision

Create a fictional marketplace with three primary application areas:

1. **Customer Storefront:** product discovery, shopping, checkout, payments, order tracking, reviews, and customer account management.
2. **Seller Center:** shop management, product catalog, inventory, order fulfillment, promotions, financial reports, and seller operations.
3. **Admin Console:** platform administration, seller onboarding, product moderation, order oversight, disputes, commissions, and platform configuration.

Use the fictional brand name MarketFlow by default. Keep branding configurable.

Do not copy Shopee or Lazada source code, logos, proprietary assets, exact branded layouts, or copyrighted product content. Use original branding, original UI components, and generated or appropriately licensed demo assets.

The application must support English and Vietnamese, multiple sellers, multiple shops, product variants, a multi-seller shopping cart, and orders containing products from different shops.

## 3. Technology Stack

Use the following stack unless a genuine technical incompatibility requires a documented adjustment.

### Core application

- Next.js 16 using the App Router.
- React and TypeScript with strict type checking.
- Tailwind CSS.
- shadcn/ui with Radix UI primitives.
- Zustand for client-side state management.
- TanStack Query for client-side server-state management where appropriate.
- Ky for typed HTTP requests.
- Zod for runtime validation and shared schemas.
- next-intl for internationalization.
- Drizzle ORM.
- SQLite as the initial database.
- Vitest for unit and integration testing.
- Playwright for end-to-end browser testing.
- Biome for formatting and linting.

### Operational tooling

- OpenTelemetry for distributed tracing and metrics instrumentation.
- Pino for structured application logging.
- Scalar for interactive OpenAPI documentation.
- mise with a `mise.toml` configuration.
- Makefile for common development tasks.
- `.editorconfig` for consistent editor settings.
- `AGENTS.md` for coding-agent instructions.
- `README.md` for setup and project documentation.
- `DESIGN.md` for UI/UX and design-system documentation.
- `lsp.json` for the supported language-server or coding-agent tooling configuration, using the actual schema required by the selected tool.
- A structured `/docs` directory for architecture, requirements, database design, API contracts, workflows, testing, and implementation planning.

Do not add unnecessary frameworks or libraries. Prefer the standard capabilities of Next.js, Drizzle, and the existing stack.

Pin or constrain tool versions appropriately, document prerequisites, and verify that package versions are compatible with Next.js 16.

## 4. Architectural Principles

Use a **modular monolith with explicit domain boundaries**.

Keep the initial implementation in one deployable Next.js application and one SQLite database. Design the domain and persistence layers so PostgreSQL can be introduced later without rewriting the entire application.

Organize the code by business domain rather than putting all features into generic components, hooks, and utility directories.

Suggested structure:

- `src/app/` — App Router routes, layouts, route handlers, and route-level UI.
- `src/components/ui/` — shadcn/ui components.
- `src/components/shared/` — reusable application-level components.
- `src/features/` — domain-oriented frontend features.
- `src/server/` — server-only application services and infrastructure.
- `src/server/modules/` — business modules.
- `src/server/db/` — database client, schema, migrations, seeds, and repositories.
- `src/server/auth/` — authentication, sessions, and authorization.
- `src/server/api/` — API infrastructure, validation, error handling, and OpenAPI integration.
- `src/lib/` — shared utilities that are genuinely cross-cutting.
- `src/i18n/` — locale configuration and request handling.
- `messages/` — English and Vietnamese translations.
- `tests/unit/` — unit tests.
- `tests/integration/` — integration tests.
- `tests/e2e/` — Playwright tests.
- `drizzle/` — generated, version-controlled database migrations.
- `scripts/` — database, maintenance, and development scripts.
- `docs/` — project documentation.

Adapt this structure when a better arrangement is justified, but preserve explicit boundaries and explain significant deviations.

### Domain modules

Create separate modules for:

- Identity and access management.
- Customer profiles and addresses.
- Seller onboarding and shops.
- Catalog, categories, attributes, and product variants.
- Inventory and stock reservations.
- Search and product discovery.
- Shopping cart and checkout.
- Pricing, promotions, and vouchers.
- Orders and order fulfillment.
- Payments and refunds.
- Shipping and tracking.
- Reviews and ratings.
- Notifications.
- Seller finance and settlements.
- Platform administration.
- Audit logging and observability.

Business rules must live in server-side domain/application services, not in React components or route handlers.

Use dependency injection or explicit dependency passing where useful. Avoid introducing a heavyweight dependency injection framework.

Never import server-only modules into client components. Add server-only safeguards to sensitive modules.

## 5. Authentication and Authorization

Implement a secure, database-backed authentication system.

Required functionality:

- Registration using email and password.
- Login and logout.
- Secure password hashing using an established password-hashing library.
- Session management using cryptographically secure opaque session tokens.
- Secure, HttpOnly, SameSite cookies.
- Session expiration, renewal, and revocation.
- Profile management.
- Password changes.
- Password-reset workflow using a development-only token delivery mechanism.
- Authentication error handling and rate limiting.
- Optional email verification through a development adapter.
- Seeded demo accounts for all principal roles.

Use a centralized authorization system with explicit permissions.

Roles:

- `CUSTOMER`
- `SELLER`
- `ADMIN`

A user may be a customer and also operate one or more seller shops. Model role assignments and shop memberships appropriately rather than assuming every user belongs to exactly one role.

Support shop-level authorization, including shop owners and staff with configurable permissions.

Enforce authorization in server-side services and database access paths. Hiding a button or page is not authorization.

Prevent:

- Access to another customer's orders.
- Access to another seller's inventory, products, or financial data.
- Unauthorized seller or administrator actions.
- Cross-tenant data leakage between shops.
- Privilege escalation through request payloads.
- Mass assignment of protected fields.

Document the authorization matrix in `/docs/security/authorization.md`.

Do not implement production authentication using hardcoded secrets, predictable session IDs, or plaintext passwords.

## 6. Customer Storefront

Implement the following features.

### 6.1 Homepage

- Responsive navigation and search.
- Product categories.
- Promotional banners.
- Flash-sale section with countdowns.
- Featured shops.
- Trending and popular products.
- Recently viewed products.
- Personalized recommendations based on available local activity data.
- Product discovery sections with pagination or load-more behavior.
- Empty, loading, and error states.

Use deterministic seeded data for demo recommendations. Do not pretend that a machine-learning recommendation engine exists.

### 6.2 Product catalog

- Category browsing with hierarchical categories.
- Product listing pages.
- Product detail pages.
- Product images and galleries.
- Product descriptions.
- Specifications and attributes.
- Brand and seller information.
- Product variants such as size, color, and capacity.
- Variant-specific price, SKU, stock, and images where appropriate.
- Regular price and promotional price.
- Product availability.
- Shipping estimates based on simulated shipping rules.
- Ratings and reviews.
- Related products.
- Favorite products.
- Recently viewed products.
- Seller shop links.

Represent purchasable variants as inventory-managed SKUs. Products without meaningful variants may use a default variant.

### 6.3 Search and discovery

Implement database-backed search supporting:

- Product name and description.
- SKU and brand.
- Category.
- Seller or shop.
- Price range.
- Minimum rating.
- Product availability.
- Sorting by relevance, price, popularity, rating, and newest.
- Pagination.
- Search suggestions based on existing product data.
- Search history for authenticated users.
- Empty-result and error states.

Start with SQLite-compatible search. Encapsulate search operations so PostgreSQL full-text search can be added later.

Do not require an external search service.

### 6.4 Shopping cart

- Add products and variants to the cart.
- Update quantities.
- Remove items.
- Select or deselect items.
- Group cart items by shop.
- Display product availability and current prices.
- Display shop subtotals.
- Display discounts, estimated shipping, and totals.
- Recover the cart after refresh.
- Merge guest cart items into the authenticated customer's cart where practical.
- Validate stock and price changes before checkout.

Use Zustand for interactive cart state when appropriate. Persist non-sensitive cart state locally for guests and synchronize authenticated carts with the server.

The server is authoritative for product prices, discounts, stock, and final totals.

Never trust client-provided totals.

### 6.5 Favorites and comparisons

- Add and remove favorite products.
- Create and manage shopping wishlists if practical.
- Compare products with compatible attributes.
- Preserve product availability and price information.
- Require authorization for private lists.

### 6.6 Customer account

Provide pages for:

- Profile.
- Address book.
- Security and password changes.
- Order history.
- Order details.
- Payment history.
- Shipment tracking.
- Cancellation requests.
- Return and refund requests.
- Product reviews.
- Favorites.
- Vouchers.
- Notifications.
- Account preferences, locale, and theme.

## 7. Multi-Vendor Marketplace and Seller Center

### 7.1 Seller onboarding

- Submit a seller application.
- Provide shop name, description, contact details, and business information.
- Display application status.
- Allow administrators to approve, reject, or request changes.
- Create a shop after approval.
- Support shop suspension and reactivation.
- Maintain audit history for administrative decisions.

Use fictitious business information in seed data.

### 7.2 Shop management

- Shop profile and branding.
- Logo and banner.
- Shop description and policies.
- Public shop storefront.
- Shop status and operational settings.
- Seller staff and permissions.
- Shop-level promotions.
- Shop-level product catalog.
- Shop-level order and sales reports.

### 7.3 Product management

Support the complete lifecycle:

- Create, edit, duplicate, and archive products.
- Save products as drafts.
- Submit products for moderation when required.
- Publish, unpublish, reject, or suspend listings.
- Manage product images.
- Manage categories and attributes.
- Manage variants and SKUs.
- Configure pricing.
- Configure sale periods.
- Manage inventory.
- Configure shipping dimensions and weight.
- Preview product listings.
- Bulk-update selected product fields.
- Import and export CSV where practical.

Validate seller ownership on every operation.

### 7.4 Inventory management

- Track on-hand, reserved, and available stock.
- Record stock adjustments.
- Record inventory movements.
- Support restocking.
- Support low-stock alerts.
- Prevent negative inventory.
- Record the reason for manual adjustments.
- Display stock history.

Available stock should be derived consistently from the inventory model.

Use database transactions and conditional updates to prevent overselling.

For checkout, reserve inventory atomically. Expire abandoned reservations and release stock when reservations or orders are cancelled.

Do not rely on a prior availability check alone; stock must be revalidated during the transaction that reserves it.

### 7.5 Seller order management

- View new, confirmed, processing, shipped, completed, cancelled, and returned orders.
- Filter and search orders.
- View order items and customer shipping details permitted for fulfillment.
- Confirm orders.
- Prepare shipments.
- Generate simulated shipping labels.
- Mark packages ready for pickup.
- Enter or generate tracking numbers.
- Process permitted cancellations and returns.
- View payment and settlement status.
- Export order reports.

The seller must only see and manage orders belonging to their authorized shop.

### 7.6 Seller analytics

Provide useful summaries:

- Gross merchandise value.
- Net sales.
- Order counts.
- Units sold.
- Average order value.
- Best-selling products.
- Revenue trends.
- Cancellation rates.
- Return rates.
- Inventory health.
- Estimated commissions.
- Pending settlements.

Define every metric precisely in documentation. Distinguish order totals, gross sales, discounts, refunds, commissions, and actual seller earnings.

## 8. Pricing, Vouchers, and Promotions

Build a reusable server-side pricing engine.

Support:

- Product-level discounts.
- Shop-level percentage discounts.
- Fixed-amount discounts.
- Platform-wide vouchers.
- Shop-specific vouchers.
- Minimum spending requirements.
- Maximum discount limits.
- Start and expiration times.
- Total redemption limits.
- Per-customer redemption limits.
- First-order promotions.
- Product and category eligibility.
- Shipping discounts.
- Flash-sale pricing.
- Promotion activation and deactivation.

The checkout UI should show the applied discount and explain why an invalid voucher cannot be used.

Define deterministic promotion precedence and stacking rules. Do not silently combine incompatible promotions.

Use integer minor currency units for financial calculations. For VND, store whole đồng amounts without floating-point arithmetic.

For percentage calculations and rounding, use documented deterministic rules.

Validate voucher eligibility and reserve or consume redemption capacity transactionally so concurrent checkouts cannot exceed limits.

Persist a complete order pricing breakdown so historical orders do not change when promotions are edited later.

## 9. Checkout and Order Processing

This is one of the highest-priority features.

### 9.1 Multi-seller checkout

A cart may contain items from multiple shops.

The customer should be able to:

1. Select cart items.
2. Choose a shipping address.
3. Select an available shipping method for each shop package.
4. Apply eligible platform and shop vouchers.
5. Review item prices, discounts, shipping fees, and final totals.
6. Choose a mock payment method.
7. Submit the order.
8. View the resulting order confirmation.

Use a parent checkout/order aggregate with seller-specific suborders, or an equivalent explicit model.

A single checkout can produce one customer-facing parent order and multiple seller orders. Each seller order must independently track fulfillment and returns where appropriate.

Clearly document the relationship between checkout, parent order, seller order, package, and payment.

### 9.2 Transactional integrity

The checkout service must:

- Authenticate the customer.
- Validate the selected cart items.
- Recalculate authoritative prices.
- Validate addresses and shipping options.
- Validate vouchers.
- Check and reserve stock.
- Create the order and seller suborders.
- Store immutable order-item snapshots.
- Persist the pricing breakdown.
- Create a payment attempt.
- Commit all database changes atomically where possible.

If any database operation fails, roll back the affected transaction and release or avoid creating inconsistent reservations.

Use an idempotency key or equivalent durable mechanism to prevent duplicate orders when customers retry requests.

Avoid performing external network calls inside long-running database transactions.

Since the initial payment providers are simulated, implement the complete database-backed flow without requiring real external services.

### 9.3 Order status machine

Define explicit states and legal transitions.

Example customer order lifecycle:

`PENDING_PAYMENT → PAID → PROCESSING → SHIPPED → DELIVERED → COMPLETED`

Additional states may include:

`CANCELLED`, `PAYMENT_FAILED`, `PARTIALLY_REFUNDED`, and `REFUNDED`.

Seller suborders must have their own fulfillment state machine.

Document the allowed transitions, responsible actors, preconditions, and side effects in `/docs/workflows/order-lifecycle.md`.

Do not implement arbitrary status updates.

Use a dedicated transition service with transaction-safe updates and audit records.

Support configurable auto-completion for delivered orders, but make the behavior deterministic and testable.

### 9.4 Order snapshots

Order items must preserve:

- Product ID and variant ID references where available.
- Product name.
- SKU.
- Variant attributes.
- Unit price.
- Quantity.
- Item discount.
- Allocated voucher discount.
- Tax or fee breakdown if implemented.
- Final item total.
- Seller and shop identity.

Changing a product listing after purchase must not alter historical order details.

## 10. Payments, Refunds, and Financial Records

Implement simulated payment adapters for:

- Cash on delivery.
- Mock wallet or online payment.
- Mock bank transfer.

Do not integrate real payment credentials or claim that real payments are processed.

Use a payment-provider interface so real providers could be introduced later.

Implement:

- Payment intents or payment attempts.
- Payment status tracking.
- Simulated successful and failed payments.
- Payment expiration.
- Retry behavior.
- Idempotent payment confirmation.
- Payment history.
- Full and partial refunds where permitted.
- Refund status tracking.
- Cancellation-related refunds.
- Audit trails.

For online payments, reserve stock and create a pending order before confirmation. Define what happens when payment expires or fails.

For cash on delivery, record the payment as pending until the simulated fulfillment workflow marks it collected.

### Financial ledger

Create an append-only financial ledger or equivalent auditable accounting records.

Track:

- Customer payments.
- Seller gross merchandise value.
- Platform commissions.
- Seller earnings.
- Refunds.
- Commission reversals.
- Settlement adjustments.
- Seller payouts or simulated settlements.

Make commission rates configurable and snapshot the applicable rate on each seller order.

Do not calculate seller earnings as a single mutable balance with no transaction history.

Implement seller settlement summaries and simulated payout records. Do not represent simulated transfers as actual bank payments.

## 11. Shipping and Returns

### Shipping

Implement a shipping-provider abstraction with local mock providers.

Support:

- Shipping methods and delivery estimates.
- Shipping fee calculations.
- Package creation.
- Tracking numbers.
- Tracking events.
- Shipment status history.
- Seller dispatch.
- In-transit updates.
- Delivery confirmation.
- Failed delivery.
- Return-to-sender where practical.

Shipping estimates and rates should be configurable and deterministic.

A parent order containing several sellers may have several independent packages.

### Returns and refunds

Support:

- Customer cancellation requests.
- Return requests.
- Return reasons.
- Evidence attachments or demo image references.
- Seller or administrator review.
- Approval and rejection.
- Return shipment tracking where appropriate.
- Refund initiation.
- Refund completion.
- Dispute escalation.

Enforce the return window and eligible order states.

Prevent duplicate refunds and ensure stock is restocked only when the configured return policy allows it.

Keep the return workflow independent from normal shipment completion.

## 12. Reviews and Notifications

### Reviews

- Only eligible customers can review purchased products.
- Enforce one review per eligible order item unless editing is explicitly supported.
- Support rating, title, body, and optional images.
- Calculate aggregate product ratings.
- Support review moderation.
- Allow customers to edit or delete their own reviews according to documented rules.
- Prevent sellers from reviewing their own products through unauthorized accounts.

### Notifications

Implement in-app notifications for:

- Registration and account events.
- Seller application status.
- Order creation.
- Payment success or failure.
- Seller order updates.
- Shipment updates.
- Delivery confirmation.
- Cancellation and refund updates.
- Return decisions.
- Voucher availability where applicable.

Support unread counts, marking individual notifications as read, and marking all as read.

Email delivery may use a development adapter that writes messages to logs or a local preview mechanism. Do not require a paid email service.

## 13. Admin Console

Create a separate, role-protected administrative area.

### Dashboard

- Order volume.
- Sales and marketplace GMV.
- Customer and seller counts.
- Seller applications awaiting review.
- Product moderation queue.
- Refund and dispute queue.
- Low-stock or operational warnings.

### User management

- Search users.
- View account details.
- Activate or suspend accounts.
- Review role assignments.
- Revoke sessions where necessary.
- Inspect audit history.

### Seller management

- Review applications.
- Approve or reject sellers.
- Suspend or reactivate shops.
- Review shop information.
- View seller performance and settlements.

### Catalog moderation

- Manage categories and attributes.
- Review product submissions.
- Approve, reject, or suspend listings.
- Record moderation reasons.
- Review reported products.

### Marketplace operations

- Search and inspect orders.
- Review payment attempts.
- Process authorized refunds.
- Handle disputes.
- Configure commissions.
- Manage platform vouchers.
- Configure shipping methods and mock provider behavior.
- Manage platform settings.

### Audit logs

Record important administrative and financial actions with actor, target, action, timestamp, and relevant metadata.

Do not store passwords, session tokens, payment secrets, or other sensitive information in audit logs.

## 14. Database Design

Use Drizzle ORM with SQLite as the initial database.

Use appropriate constraints, foreign keys, unique indexes, and query indexes.

At minimum, design the following entities or equivalent domain tables:

- Users
- UserRoles or role assignments
- Sessions
- PasswordResetTokens
- CustomerProfiles
- Addresses
- Shops
- ShopMemberships
- SellerApplications
- Categories
- Brands
- ProductAttributes
- Products
- ProductVariants
- ProductImages
- Inventory
- InventoryMovements
- StockReservations
- Carts
- CartItems
- Wishlists
- WishlistItems
- Vouchers
- VoucherRedemptions
- Promotions
- Orders
- SellerOrders
- OrderItems
- OrderPricingBreakdowns
- Payments
- PaymentAttempts
- Refunds
- Shipments
- ShipmentItems
- TrackingEvents
- ReturnRequests
- ReturnItems
- Reviews
- Notifications
- NotificationPreferences
- FinancialLedgerEntries
- SellerSettlements
- SettlementItems
- AuditLogs
- IdempotencyRecords
- ApplicationSettings

Do not create every table mechanically if a simpler normalized design is better. Document important modeling decisions and relationships.

### Database rules

- Use stable primary keys.
- Use explicit foreign-key relationships.
- Store monetary amounts as integer minor units.
- Store timestamps consistently in UTC.
- Store the relevant business-timezone configuration where required.
- Use unique constraints for emails, SKUs within the appropriate scope, session token hashes, and idempotency keys.
- Add indexes for common listing, filtering, lookup, and reporting queries.
- Use transactions for operations that span related records.
- Define deletion and retention behavior for orders and financial records.
- Avoid destructive deletion of financial history.
- Use database constraints in addition to application validation.

### SQLite and PostgreSQL portability

SQLite is the initial target; PostgreSQL is a future target.

Design the persistence layer to isolate dialect-specific behavior.

- Use Drizzle's SQLite schema and query APIs for the initial application.
- Keep business services independent of raw SQL dialect details.
- Avoid SQLite-specific assumptions leaking into domain logic.
- Document differences in transaction behavior, concurrency, types, indexes, and search.
- Create a PostgreSQL migration plan.
- Identify queries or schema elements requiring PostgreSQL-specific implementations.
- Use separate dialect-specific schemas or persistence implementations when necessary.

Do not pretend that changing a connection string alone migrates a SQLite database to PostgreSQL.

Do not implement a generic database abstraction that obscures Drizzle or duplicates its functionality.

## 15. Database Migrations and Seed Data

Use version-controlled Drizzle migrations.

Provide commands for:

- Generating migrations.
- Applying migrations.
- Inspecting migration status where supported.
- Resetting a development database.
- Seeding development data.
- Running safe test database setup.

Keep the schema source, generated migration files, and database initialization instructions consistent.

Never automatically destroy a non-test database during application startup.

### Seed data

Create realistic, deterministic, idempotent development seed data, including:

- Admin accounts.
- Customer accounts.
- Approved sellers and shops.
- At least one pending seller application.
- Multiple categories and nested categories.
- Brands and product attributes.
- Products with multiple variants.
- Different inventory levels.
- Active and inactive promotions.
- Platform and shop vouchers.
- Sample customer carts.
- Orders across multiple lifecycle states.
- Payment attempts and simulated failures.
- Shipment and tracking events.
- Reviews and ratings.
- Return and refund examples.
- Seller financial records.
- Notifications and moderation cases.

Provide documented demo credentials and a clear warning that seeded credentials must never be used in production.

Use original sample product data and local or appropriately licensed image assets.

## 16. API Design and OpenAPI

Use Next.js Route Handlers for the public application API where appropriate.

Create versioned endpoints under `/api/v1`.

Use consistent request and response contracts, Zod validation, and a standardized error format.

Implement endpoints for:

- Authentication and sessions.
- Customer profile and addresses.
- Public catalog and search.
- Product details and shop storefronts.
- Cart operations.
- Checkout.
- Customer orders.
- Seller applications and shop management.
- Seller products and inventory.
- Seller orders and fulfillment.
- Promotions and vouchers.
- Payments and refunds.
- Shipments and tracking.
- Reviews.
- Notifications.
- Administrative management.
- Health and readiness checks.

Document important routes, authorization requirements, request schemas, response schemas, and failure cases.

### API conventions

- Use appropriate HTTP methods and status codes.
- Validate request parameters, query parameters, and request bodies.
- Validate resource ownership and permissions.
- Use pagination for collection endpoints.
- Provide consistent error codes and useful error messages.
- Support idempotency for appropriate write operations.
- Avoid leaking stack traces or internal details.
- Do not expose database entities directly when doing so would compromise the API contract.
- Keep public and internal APIs clearly separated.

Generate or maintain an OpenAPI 3.x specification from the actual route contracts.

Expose Scalar as an interactive API documentation interface in development, with an explicit production access policy.

Do not create an OpenAPI document that describes routes that do not exist.

## 17. Frontend Architecture and State Management

Use the correct tool for each type of state.

### Zustand

Use Zustand for client-owned interactive state, such as:

- Cart interaction state when client-side cart behavior is useful.
- Selected product variant.
- Compare-list state.
- Temporary UI preferences.
- Multi-step checkout presentation state where appropriate.

Do not duplicate all server data into Zustand.

### TanStack Query

Use TanStack Query for client-side server-state workflows that benefit from caching and synchronization.

Implement appropriate query keys, invalidation, mutation handling, retries, and error states.

Do not automatically refetch every query or retry non-idempotent mutations without considering their effects.

Use server-side data fetching for appropriate initial page renders.

### Ky

Use Ky for typed client-side HTTP requests when requests need to cross the API boundary.

Centralize API configuration, error normalization, and request behavior.

Do not use Ky unnecessarily for internal server-to-server calls that can use application services directly.

### Zod

Use Zod to validate untrusted external inputs, environment configuration, form payloads, and API boundaries.

Share schemas where appropriate without importing server-only dependencies into client bundles.

### React and Next.js

- Use Server Components by default.
- Use Client Components only when interactivity or browser APIs require them.
- Use Server Actions selectively for appropriate form and mutation workflows.
- Keep business logic in server-side application services.
- Prevent duplicate data fetching.
- Use URL search parameters for shareable listing filters and sorting.
- Use proper loading, error, empty, and not-found states.
- Use accessible forms and keyboard navigation.

Do not force every interaction through an API call if a safe server-side application service is more appropriate.

## 18. UI/UX and Design System

Build a polished, original, marketplace-style interface.

### Design principles

- Responsive from mobile to desktop.
- Consistent spacing and typography.
- Clear visual hierarchy.
- Strong product imagery.
- Accessible contrast.
- Consistent form controls.
- Reusable cards, tables, dialogs, menus, tabs, and pagination.
- Consistent loading skeletons and feedback.
- Appropriate empty states.
- Clear validation errors.
- Avoid unnecessary gradients, decorative effects, and excessive animation.
- Avoid making the interface look like a generic admin template.

### Responsive behavior

Support at least:

- Small mobile: 320–375 px.
- Standard mobile: 390–430 px.
- Tablet: 768 px.
- Laptop: 1024–1440 px.
- Large desktop: 1920 px.

Ensure navigation, product grids, filter panels, cart, checkout, seller tables, and admin layouts adapt appropriately.

On small screens, use appropriate drawers, bottom sheets, stacked layouts, or simplified tables rather than simply shrinking desktop layouts.

### Theme support

Support Light, Dark, and System modes.

Persist user theme preferences appropriately and prevent theme flashing during initialization.

Ensure shadcn/ui components, charts, tables, dialogs, and form states work in all themes.

### Accessibility

Target WCAG 2.2 AA where practical.

Support keyboard navigation, visible focus indicators, semantic HTML, accessible names, dialog focus management, reduced motion, and appropriate screen-reader announcements.

### DESIGN.md

Document:

- Brand principles.
- Color tokens.
- Typography.
- Spacing.
- Border radii.
- Shadows.
- Breakpoints.
- Component conventions.
- Theme behavior.
- Accessibility requirements.
- Page layout principles.
- Examples of approved and discouraged patterns.

## 19. Internationalization

Use next-intl for `en` and `vi`.

Implement locale-aware routing, such as:

- `/en/...`
- `/vi/...`

Ensure locale handling is consistent across storefront, Seller Center, Admin Console, validation messages, and notifications.

Requirements:

- No hardcoded user-facing strings in application components.
- English and Vietnamese translation dictionaries.
- Translation of navigation, forms, statuses, errors, empty states, and accessibility labels.
- Locale-aware number, date, and currency formatting.
- Language switching that preserves the current page where possible.
- Correct handling of localized URLs.
- Tests that detect missing translations.

Use VND as the initial primary currency and document currency-formatting conventions.

Do not assume that changing the locale changes stored monetary values.

## 20. Observability and Logging

### Pino

Implement structured JSON logging with:

- Timestamp.
- Log level.
- Environment.
- Service/application name.
- Request ID.
- Trace ID where available.
- Operation name.
- Error details with sensitive information redacted.

Configure development-friendly output and production-friendly structured logs.

Never log passwords, raw session tokens, authentication cookies, reset tokens, or payment secrets.

### OpenTelemetry

Implement OpenTelemetry instrumentation for:

- HTTP request traces.
- Application operations.
- Database operations where supported.
- Checkout and order-processing workflows.
- Payment and shipping simulations.
- Error and latency metrics.

Use appropriate instrumentation packages compatible with the selected Next.js runtime.

Do not initialize instrumentation in client bundles.

Make exporter configuration environment-driven. Support local development without requiring an external observability platform.

Document how to run with a local telemetry collector if needed.

### Operational endpoints

Implement suitable health and readiness endpoints.

Health checks must not expose environment variables, secrets, database credentials, or internal implementation details.

## 21. Security Requirements

Treat security as a core feature.

Implement and test:

- Server-side authentication and authorization.
- Secure session management.
- Password hashing.
- Request validation.
- SQL injection prevention through safe parameterized database operations.
- CSRF protection appropriate to the authentication and request model.
- XSS prevention.
- Secure file-upload validation if uploads are implemented.
- Rate limiting on sensitive operations.
- Safe error responses.
- Security headers.
- Protection against insecure direct object references.
- Login and password-reset abuse controls.
- Sensitive-field redaction.
- Audit trails for administrative and financial actions.
- Environment variable validation.
- Protection against mass assignment.
- Safe handling of untrusted redirect URLs.
- Transactional inventory and payment state changes.

Keep secrets in environment variables or a suitable secret manager.

Provide `.env.example` with safe placeholders only.

Do not commit production credentials or sensitive user data.

Do not expose administrative or internal debugging routes publicly without explicit authorization.

## 22. Performance and Reliability

- Use server rendering where beneficial.
- Optimize product images and responsive image sizes.
- Avoid unnecessarily large client bundles.
- Use pagination rather than unbounded database queries.
- Add appropriate database indexes.
- Avoid N+1 query patterns.
- Cache public data selectively.
- Invalidate cached catalog data after relevant changes.
- Avoid caching private customer or seller responses across users.
- Keep cart and checkout data authoritative on the server.
- Handle concurrent writes safely.
- Make retries and idempotency explicit.
- Provide meaningful error boundaries.
- Ensure migrations and seeds are deterministic.

Measure performance before introducing complex caching or infrastructure.

## 23. Testing Strategy

### Vitest

Use Vitest for unit and integration tests.

Cover:

- Pricing calculations.
- Voucher eligibility.
- Promotion stacking rules.
- Commission calculations.
- Currency rounding.
- Inventory reservation and release.
- Order state transitions.
- Cancellation rules.
- Return and refund eligibility.
- Session and permission checks.
- Input validation.
- API error handling.
- Localization utilities.

Use a real isolated SQLite database for database integration tests where appropriate.

Test transactional behavior and database constraints, not only mocked repository calls.

Ensure test data is isolated and test cleanup is reliable.

### Playwright

Implement browser-based end-to-end tests covering at least:

1. Customer registration and login.
2. Product search, filtering, and sorting.
3. Product variant selection.
4. Cart operations.
5. Multi-shop checkout.
6. Successful simulated payment.
7. Failed payment and retry.
8. Order cancellation.
9. Customer order tracking.
10. Return and refund workflow.
11. Seller onboarding.
12. Seller product creation and publication.
13. Inventory adjustment.
14. Seller order fulfillment.
15. Admin seller approval.
16. Product moderation.
17. Voucher validation.
18. English/Vietnamese switching.
19. Light/Dark/System themes.
20. Authorization failures and cross-shop access prevention.

Use deterministic fixtures and mock external integrations.

Avoid brittle tests based on arbitrary timeouts, exact DOM nesting, or production network dependencies.

### Quality gates

Define and document the required commands for:

- Formatting checks.
- Linting.
- Type checking.
- Unit tests.
- Integration tests.
- End-to-end tests.
- Production build.

CI must fail when a required quality gate fails.

Do not disable type checking or weaken assertions just to make the pipeline pass.

Set coverage thresholds after establishing a baseline, prioritizing domain logic, authorization, financial calculations, and transaction boundaries.

## 24. Developer Experience and Repository Files

Create and maintain the following files.

### `mise.toml`

Define the required runtime and tool versions where supported. Document prerequisites and installation instructions.

### `AGENTS.md`

Include:

- Project overview.
- Architecture boundaries.
- Coding conventions.
- Commands for setup, migration, seed, development, tests, and builds.
- Database safety rules.
- Security requirements.
- Testing expectations.
- Documentation maintenance rules.
- Instructions for implementing features incrementally.

Keep it concise enough to be useful to coding agents.

### `README.md`

Include:

- Project description.
- Feature overview.
- Technology stack.
- Prerequisites.
- Installation.
- Environment configuration.
- Database initialization.
- Migration and seed instructions.
- Development commands.
- Test commands.
- Demo accounts.
- Architecture overview.
- OpenAPI and Scalar access.
- Troubleshooting.
- Current limitations.
- Future PostgreSQL migration plan.

### `.editorconfig`

Configure consistent indentation, line endings, charset, trailing whitespace, and final newlines.

### `DESIGN.md`

Document the visual system and reusable UI conventions.

### `Makefile`

Provide discoverable commands, such as:

- `make setup`
- `make dev`
- `make build`
- `make lint`
- `make format`
- `make typecheck`
- `make test`
- `make test-unit`
- `make test-integration`
- `make test-e2e`
- `make db-generate`
- `make db-migrate`
- `make db-seed`
- `make db-reset`
- `make check`

Adapt targets to the actual scripts and available tools. Never define a command that silently performs a different operation from its name.

### `lsp.json`

Inspect the target coding agent or development tool's documented configuration schema before creating this file. Configure supported language-server integration only when the target tool recognizes the format.

Do not invent a generic schema and claim that it works with every language server or coding agent.

If this filename is not recognized by the selected tool, document the limitation and provide the correct configuration for the intended tool.

### `/docs`

Maintain organized documentation for:

- Product requirements.
- Architecture.
- Domain boundaries.
- Database schema.
- API conventions.
- Authentication and authorization.
- Order lifecycle.
- Inventory reservation.
- Pricing and vouchers.
- Payments and refunds.
- Shipping and returns.
- Observability.
- Testing strategy.
- Deployment.
- PostgreSQL migration.
- Implementation roadmap.
- Known limitations.

Update relevant documentation as features are implemented.

## 25. Required Documentation Files

Create these documents before implementing complex business features:

- `docs/requirements/product-requirements.md`
- `docs/architecture/system-architecture.md`
- `docs/architecture/module-boundaries.md`
- `docs/architecture/adr/`
- `docs/database/data-model.md`
- `docs/database/sqlite-postgresql-portability.md`
- `docs/api/api-conventions.md`
- `docs/security/authorization.md`
- `docs/security/security-model.md`
- `docs/workflows/order-lifecycle.md`
- `docs/workflows/checkout-and-inventory.md`
- `docs/workflows/payment-and-refund.md`
- `docs/testing/testing-strategy.md`
- `docs/operations/observability.md`
- `docs/operations/local-development.md`
- `docs/roadmap/implementation-plan.md`
- `docs/roadmap/known-limitations.md`

Add diagrams using Mermaid where they materially clarify architecture, data relationships, or workflows.

Documentation must describe implemented behavior accurately. Mark planned features as planned rather than implemented.

## 26. Implementation Roadmap

Implement the project in the following phases.

### Phase 0 — Repository inspection and planning

- Inspect the existing repository.
- Identify existing code, tools, and constraints.
- Confirm Next.js, React, Drizzle, and library compatibility.
- Define the domain model and architectural boundaries.
- Create the product requirements and implementation roadmap.
- Record significant architectural decisions.

Deliverable: approved architecture and an actionable implementation plan.

### Phase 1 — Project foundation

- Initialize or configure Next.js 16.
- Configure TypeScript, Tailwind CSS, shadcn/ui, and Biome.
- Configure mise, environment validation, and Makefile.
- Set up next-intl and themes.
- Configure Drizzle and SQLite.
- Implement initial migrations and seed infrastructure.
- Configure Vitest and Playwright.
- Establish logging, tracing, and API conventions.
- Create the documentation structure.

Deliverable: a running application with a verified development environment and automated quality gates.

### Phase 2 — Identity and application shell

- Implement registration, login, logout, and sessions.
- Implement role and shop-membership authorization.
- Build responsive storefront, Seller Center, and Admin layouts.
- Implement language switching and theme selection.
- Add demo accounts and protected routes.
- Test unauthorized and cross-account access.

Deliverable: working application shells and secure access control.

### Phase 3 — Catalog and discovery

- Implement categories, brands, products, variants, and images.
- Build homepage, category pages, search, filters, and sorting.
- Implement shop storefronts.
- Build Seller Center product management.
- Add product moderation.

Deliverable: customers can discover products and sellers can manage authorized listings.

### Phase 4 — Cart, pricing, and promotions

- Implement customer carts.
- Implement server-side pricing.
- Implement vouchers and promotion rules.
- Add stock validation.
- Build checkout review screens.
- Add pricing and concurrency tests.

Deliverable: correct cart calculations and a validated checkout preview.

### Phase 5 — Transactional checkout and orders

- Implement multi-seller checkout.
- Implement inventory reservations.
- Create parent orders and seller suborders.
- Add order-item snapshots.
- Add idempotency protection.
- Implement order state machines.
- Test rollback, retries, and overselling scenarios.

Deliverable: a reliable end-to-end order creation workflow.

### Phase 6 — Payments, shipping, and fulfillment

- Implement mock payment adapters.
- Add payment attempts and payment confirmation.
- Implement simulated shipping providers.
- Add tracking events and delivery states.
- Build Seller Center fulfillment workflows.
- Implement cancellation and inventory release.
- Add payment and shipment failure handling.

Deliverable: orders can be paid, fulfilled, tracked, and cancelled according to defined rules.

### Phase 7 — Returns and marketplace finance

- Implement return requests and approvals.
- Implement full and partial refunds.
- Add commission calculations.
- Implement financial ledger records.
- Add seller settlement reports.
- Test duplicate refunds and financial invariants.

Deliverable: auditable simulated marketplace financial operations.

### Phase 8 — Customer engagement and administration

- Implement reviews and moderation.
- Implement notifications.
- Complete admin management screens.
- Add seller onboarding and suspension workflows.
- Add dashboard analytics and reporting.

Deliverable: complete primary customer, seller, and administrator workflows.

### Phase 9 — Quality and operational hardening

- Complete Vitest coverage for critical domain rules.
- Complete Playwright critical-path coverage.
- Test authorization boundaries.
- Audit transaction handling and error recovery.
- Review performance and database indexes.
- Validate accessibility and localization.
- Complete OpenAPI and Scalar documentation.
- Verify telemetry and log redaction.
- Verify production build and deployment instructions.
- Review PostgreSQL migration readiness.

Deliverable: a coherent, documented, tested educational marketplace application.

## 27. Definition of Done

A feature is complete only when all applicable criteria are satisfied:

- Its business behavior is implemented.
- Its UI is responsive and accessible.
- Its API validates untrusted inputs.
- Authentication and authorization are enforced server-side.
- Database changes use migrations.
- Important operations preserve transaction integrity.
- Loading, success, empty, and failure states exist.
- English and Vietnamese translations are complete.
- Light, Dark, and System themes work.
- Unit or integration tests cover the relevant business rules.
- E2E tests cover important user journeys.
- Documentation is updated.
- Linting, formatting, type checking, tests, and production build pass.

Do not mark a feature complete merely because a page renders or a button has been added.

## 28. Working Rules for the Coding Agent

1. Start by inspecting the repository and installed tooling.
2. Produce a concise implementation plan and identify risks before making major changes.
3. Establish architecture, migrations, and testing infrastructure before implementing complex business workflows.
4. Work in small, verifiable increments.
5. Prefer complete vertical slices over large sets of disconnected placeholder pages.
6. After each phase, run the relevant checks and resolve failures before proceeding.
7. Never fabricate test results or claim that unexecuted tests passed.
8. Never silently replace a requested technology.
9. Avoid unnecessary abstractions, premature optimization, and microservices.
10. Do not create placeholder buttons or fake functionality without clearly labeling it as a planned feature.
11. Do not bypass security checks to simplify development.
12. Never weaken financial, inventory, or authorization invariants to make tests pass.
13. Keep demo data deterministic and resettable.
14. Maintain an implementation checklist in `docs/roadmap/implementation-plan.md`.
15. Update `docs/roadmap/known-limitations.md` whenever an important limitation is discovered.
16. Ask for clarification only when a genuinely blocking product or architectural decision cannot be resolved with a reasonable documented default.

If the full scope cannot be completed in one session, finish the current vertical slice, run its checks, update the roadmap, and report exactly what is implemented, what has been verified, and what remains.

## 29. Initial Execution Instructions

Begin now with Phase 0.

First, inspect the repository and determine whether it is empty or already initialized.

Then:

1. Propose the architecture and explain important technical decisions.
2. Define the core entities and relationships for users, shops, products, variants, inventory, carts, orders, payments, shipments, and financial records.
3. Identify the most important risks, especially SQLite/PostgreSQL portability, Next.js server/client boundaries, multi-seller checkout, inventory concurrency, and authorization.
4. Create the required documentation and initial implementation checklist.
5. Configure Phase 1.
6. Run the available validation commands and fix failures.
7. Report the completed work and propose the next concrete implementation step.

Do not attempt to generate the entire marketplace in a single pass. Build it as a maintainable, testable, progressively complete application.
