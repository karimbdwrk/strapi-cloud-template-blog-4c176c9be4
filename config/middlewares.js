module.exports = [
  'strapi::logger',
  'strapi::errors',
  'strapi::security',
  // Sessions par cookie (config/plugins.js) : seul le site peut appeler l'API avec ses cookies.
  // CORS_ORIGINS : adresses du site séparées par des virgules (défaut : FRONT_URL)
  {
    name: 'strapi::cors',
    config: process.env.AUTH_SESSION_COOKIE === 'true'
      ? {
          origin: (process.env.CORS_ORIGINS || process.env.FRONT_URL || 'http://localhost:3010')
            .split(',')
            .map((o) => o.trim().replace(/\/$/, ''))
            .filter(Boolean),
          credentials: true,
        }
      : {},
  },
  'strapi::poweredBy',
  'strapi::query',
  // Corps brut conservé pour vérifier la signature des webhooks Stripe
  { name: 'strapi::body', config: { includeUnparsed: true } },
  'strapi::session',
  'strapi::favicon',
  'strapi::public',
];
