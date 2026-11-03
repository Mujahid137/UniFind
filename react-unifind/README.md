# UniFind showcase

Campus lost-and-found application with a student workspace, report forms, item search, matching, claims, and an administration dashboard.

**Live demo:** https://unifind-showcase.vercel.app

This showcase uses browser-local demo data. Reports, claims, accounts, and admin changes stay in the current browser. Authentication is simulated for demonstration. The separate server directory is not used or deployed by this Vercel showcase.

## Run locally

```sh
npm ci
npm run dev
```

## Production build

```sh
npm run build
npm run preview
```

Vercel builds with Vite and serves `dist`. The rewrite in `vercel.json` supports direct links and refreshes on application routes.

## Explore

- Choose **Login as Guest** on the home page to open the student dashboard.
- Open `/admin` with `admin@unifind.demo` and `UniFindDemo123!` for the demo administration workspace.
- See [showcase/README.md](showcase/README.md) for the screenshot collection and agency copy.

The `showcase-vercel` branch packages this local demo separately from the existing application on `main`.
