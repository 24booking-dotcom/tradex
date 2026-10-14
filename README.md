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

## Alertas por correo (opcional)

Cuando aparece una señal nueva se envía **un solo correo** con todas las señales nuevas de esa ejecución. Usa [Resend](https://resend.com).

Variables en Vercel (Settings → Environment Variables):

| Variable | Obligatoria | Descripción |
|---|---|---|
| `RESEND_API_KEY` | sí | API key de Resend |
| `ALERT_EMAIL_TO` | sí | Destinatario(s), separados por coma |
| `ALERT_MIN_TIER` | no | `scalp`, `moderate` (por defecto) o `massive`. Con `moderate` no se avisa de BUY/SELL |
| `ALERT_EMAIL_FROM` | no | Remitente. Por defecto `onboarding@resend.dev` (Resend solo entrega a tu propio correo hasta que verifiques un dominio) |
| `APP_URL` | no | URL de la app para el enlace del correo |
| `CRON_SECRET` | recomendada | Protege `/api/sync` |

Solo se avisa de señales de las últimas 3 velas; las más viejas se marcan como vistas sin enviar correo, para no inundar la bandeja.

### Ejecución cada 5 minutos

El cron de Vercel Hobby corre una vez al día, así que `.github/workflows/sync.yml` llama a `/api/sync` cada 5 minutos desde GitHub Actions.
Agrega en GitHub (Settings → Secrets and variables → Actions) los secrets `SYNC_URL` (`https://TU-DOMINIO/api/sync`) y `CRON_SECRET` (el mismo valor que en Vercel).
