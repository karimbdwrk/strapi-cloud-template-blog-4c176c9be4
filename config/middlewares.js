module.exports = [
  'strapi::logger',
  'strapi::errors',
  'strapi::security',
  'strapi::cors',
  'strapi::poweredBy',
  'strapi::query',
  // Corps brut conservé pour vérifier la signature des webhooks Stripe
  { name: 'strapi::body', config: { includeUnparsed: true } },
  'strapi::session',
  'strapi::favicon',
  'strapi::public',
];
