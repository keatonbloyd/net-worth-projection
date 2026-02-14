# Net Worth Projection Calculator

A responsive web app that projects your net worth at age 65 based on configurable monthly savings and compounding interest rates.

## Local Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

The production build is output to `dist/`.

## Deploy to Vercel

### Option A: Via GitHub (recommended)

1. Push this project to a GitHub repository.
2. Go to [vercel.com](https://vercel.com) and sign in with GitHub.
3. Click **"Add New Project"** and import your repo.
4. Vercel auto-detects Vite — no configuration needed.
5. Click **Deploy**.

### Option B: Via Vercel CLI

```bash
npm i -g vercel
vercel
```

Follow the prompts. Vercel auto-detects the Vite framework.

## Tech Stack

- React 18
- Recharts (charts)
- Vite (build tool)
- localStorage (persistence)

## Author

Keaton Bloyd
