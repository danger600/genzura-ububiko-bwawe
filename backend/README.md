# UBUBIKO SMART API

Node.js + Express + MongoDB Atlas backend for the UBUBIKO SMART frontend. The frontend can be hosted on Vercel and calls this API at the service URL plus `/api`; the service also serves the root `index.html` as a same-origin fallback.

## Features

- JWT authentication with hashed passwords
- Role-based authorization: Admin, Manager, Cashier and Storekeeper
- Products and inventory
- Transaction-safe stock IN / OUT operations
- Stock requests and approval
- Suppliers and customers
- Returns and restocking
- User administration and audit history
- Health endpoint for Render

## Local setup

1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env`.
3. Create a MongoDB Atlas database and place its connection URI in `MONGODB_URI`.
4. Generate a private JWT secret (at least 32 characters) and place it in `JWT_SECRET`.
5. Install packages and create the first administrator:

```bash
npm install
npm run seed:admin
npm run dev
```

The API runs at `http://localhost:10000` by default. Check `/api/health`.

## Render

This repository includes a root `render.yaml` Blueprint. Create a Blueprint deployment from this repository. Set:

- `MONGODB_URI`: the MongoDB Atlas connection string
- `CLIENT_ORIGIN`: extra browser origins allowed by CORS, separated by commas (optional). The production frontend, its Vercel/Netlify preview deployments and localhost are allowed by default; `*` wildcards such as `https://my-project-*.vercel.app` are supported.

Render generates `JWT_SECRET` from the Blueprint. Keep every secret in Render Environment settings, never in Git.

After changing `render.yaml`, deploy the Blueprint update (or update `CLIENT_ORIGIN` in Render → Environment) and redeploy so the new CORS rules take effect. The API serves the frontend same-origin at its root as a fallback, so `https://genzura-ububiko-bwawe.onrender.com/` works even if a Vercel deployment is unavailable.

MongoDB Atlas must also allow connections from Render. In Render, open the service, click **Connect → Outbound**, and copy the outbound IP ranges for the service region. In Atlas, go to **Database & Network Access → IP Access List** and add those CIDR ranges. A temporary `0.0.0.0/0` entry can unblock testing, but use a strong database password and restrict the list to Render ranges afterwards.

The API health check is `/api/health`. For the Vercel frontend, enter this service URL plus `/api` in the login screen (for example `https://your-service.onrender.com/api`).

## Authentication

Send the token from `POST /api/auth/login` on protected routes:

```http
Authorization: Bearer YOUR_JWT_TOKEN
```

Login body:

```json
{
  "username": "your-admin-username",
  "password": "your-admin-password"
}
```

## OAuth sign-in (Google and GitHub)

Optional: the login screen shows **Continue with Google/GitHub** when the matching credentials are configured.

1. In Google Cloud Console, create an OAuth client (Web application) and add `https://genzura-ububiko-bwawe.onrender.com/api/auth/oauth/google/callback` as an authorized redirect URI.
2. In GitHub → Settings → Developer settings → OAuth Apps, set the callback URL to `https://genzura-ububiko-bwawe.onrender.com/api/auth/oauth/github/callback`.
3. In Render → Environment, set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`. Keep `OAUTH_CALLBACK_BASE` pointing at the service URL.
4. Give the user an email on file: seed the admin with `npm run seed:admin` (it now asks for an optional email), or have an Admin add/edit a user's email in **Admin & Users**. OAuth only matches accounts with the same verified email.
5. Keep `OAUTH_ALLOW_SIGNUP=false` unless you want any verified Google/GitHub account to auto-create a user with role `OAUTH_DEFAULT_ROLE` (default `Storekeeper`).

OAuth delegates the password check to the provider; after a successful callback the API still issues its own short-lived JWT, which the frontend exchanges through `/api/auth/oauth/exchange`. Username/password login remains available.

## Main API routes

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/health` | API and database health |
| POST | `/api/auth/login` | Sign in |
| GET | `/api/auth/me` | Current user |
| POST | `/api/auth/change-password` | Change own password |
| GET/POST | `/api/products` | List / create products |
| PATCH/DELETE | `/api/products/:id` | Update / delete product |
| GET/POST | `/api/movements` | Stock history / stock IN or OUT |
| GET/POST | `/api/requests` | List / create stock requests |
| PATCH | `/api/requests/:id/status` | Approve, reject or process a request |
| GET/POST | `/api/suppliers` | List / create suppliers |
| PATCH/DELETE | `/api/suppliers/:id` | Update / delete supplier |
| GET/POST | `/api/customers` | List / create customers |
| GET/POST | `/api/returns` | List / register returns |
| PATCH | `/api/returns/:id/status` | Review or restock a return |
| GET/POST | `/api/users` | List / create users (Admin) |
| PATCH | `/api/users/:id/block` | Block / unblock user (Admin) |
| PATCH | `/api/users/:id/password` | Reset a user's password (Admin) |
| GET | `/api/audit` | View audit history |

The static frontend in the repository root is already connected to this API. It defaults to `https://genzura-ububiko-bwawe.onrender.com/api` and stores the JWT in `sessionStorage`; no cookies are used, so CORS does not need credentials.
