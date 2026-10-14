# Welcome to your Lovable project

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Open your project in the [Lovable editor](https://lovable.dev) and keep building.

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: connect the project to GitHub and every change made in Lovable is committed straight to your repository.
- **Full ownership**: this code is yours. Push to your repository and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Built with

- TanStack Start
- TypeScript
- React
- Tailwind CSS

## Historial persistente de señales (opcional)

Sin base de datos, el historial cubre solo las últimas 500 velas. Para guardarlo:

1. En Vercel: **Storage → Create → Neon (Postgres)** y conéctalo al proyecto. Define `DATABASE_URL` (o `POSTGRES_URL`).
2. Opcional: define `CRON_SECRET` para proteger `/api/sync`.
3. Redespliega. La tabla `signals` se crea sola.

Las señales se guardan cuando alguien abre la app y también a diario con el cron de `vercel.json` (`/api/sync`).
En el plan Hobby de Vercel los crons corren como máximo una vez al día, así que el intervalo de 1m solo se guarda mientras la app está abierta.
