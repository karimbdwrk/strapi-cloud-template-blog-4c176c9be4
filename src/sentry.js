'use strict';

/**
 * Suivi des erreurs (Sentry, région UE). Inactif sans SENTRY_DSN (en local par exemple).
 *
 * Remonté à Sentry :
 * - les erreurs 500 des routes de l'API (middleware global::sentry) ;
 * - les erreurs journalisées par strapi.log.error (webhooks, factures, emails, virements…) ;
 * - les erreurs non rattrapées du serveur ;
 * - l'exécution des tâches planifiées (Sentry Crons) : une tâche qui ne s'est pas lancée à
 *   l'heure, qui dure trop longtemps ou qui échoue déclenche une alerte.
 *   SENTRY_CRONS : tâches surveillées, séparées par des virgules, ou « all »
 *   (défaut : mondayPayouts, l'offre gratuite ne surveille qu'une tâche).
 *
 * Données de santé : rien de personnel n'est envoyé. Pas d'adresse IP, pas de cookies, pas
 * d'en-têtes d'authentification, pas de corps de requête ni de paramètres d'URL ; les adresses
 * email et les jetons éventuellement présents dans les messages sont masqués.
 */

const Sentry = require('@sentry/node');

const DSN = process.env.SENTRY_DSN;
let enabled = false;

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const TOKEN_RE = /\b(eyJ[\w-]+\.[\w-]+\.[\w-]+|(sk|pk|rk|whsec|acct|cus|pi|ch|in|po|sub)_[A-Za-z0-9_]{8,})\b/g;
const scrubText = (text) =>
	typeof text === 'string' ? text.replace(EMAIL_RE, '[email]').replace(TOKEN_RE, '[jeton]') : text;

/** Adresse sans paramètres (?email=…, ?token=…) */
const stripQuery = (url) => (typeof url === 'string' ? url.split('?')[0] : url);

const scrubEvent = (event) => {
	if (event.request) {
		event.request = {
			method: event.request.method,
			url: stripQuery(event.request.url),
		};
	}
	if (event.user) event.user = event.user.id ? { id: String(event.user.id) } : undefined;
	if (event.message) event.message = scrubText(event.message);
	if (event.logentry?.message) event.logentry.message = scrubText(event.logentry.message);
	for (const exception of event.exception?.values || []) {
		exception.value = scrubText(exception.value);
		for (const frame of exception.stacktrace?.frames || []) delete frame.vars;
	}
	if (event.extra) {
		for (const key of Object.keys(event.extra)) event.extra[key] = scrubText(String(event.extra[key]));
	}
	return event;
};

const scrubBreadcrumb = (crumb) => {
	// Journaux de la console : peuvent contenir des données de compte
	if (crumb.category === 'console') return null;
	if (crumb.data?.url) crumb.data.url = stripQuery(crumb.data.url);
	if (crumb.message) crumb.message = scrubText(crumb.message);
	return crumb;
};

const init = () => {
	if (!DSN || enabled) return;
	Sentry.init({
		dsn: DSN,
		environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
		release: process.env.SENTRY_RELEASE || undefined,
		sendDefaultPii: false,
		// Pas de suivi des performances : seulement les erreurs et les tâches planifiées
		tracesSampleRate: 0,
		beforeSend: scrubEvent,
		beforeBreadcrumb: scrubBreadcrumb,
	});
	enabled = true;
};

/** Erreur envoyée à Sentry avec un peu de contexte (jamais de données personnelles) */
const captureError = (error, context = {}) => {
	if (!enabled) return;
	Sentry.withScope((scope) => {
		for (const [key, value] of Object.entries(context)) if (value !== undefined) scope.setTag(key, String(value));
		Sentry.captureException(error);
	});
};

/** strapi.log.error remonte aussi à Sentry (les erreurs rattrapées puis journalisées) */
const hookLogger = (strapi) => {
	if (!enabled || strapi.log.__sentry) return;
	const original = strapi.log.error.bind(strapi.log);
	strapi.log.error = (...args) => {
		original(...args);
		try {
			const error = args.find((a) => a instanceof Error);
			const text = args.filter((a) => typeof a === 'string').join(' ');
			if (error) captureError(error, { source: 'log' });
			else if (text) Sentry.captureMessage(text, 'error');
		} catch {
			// Le suivi des erreurs ne doit jamais casser le serveur
		}
	};
	strapi.log.__sentry = true;
};

const monitoredCrons = () => {
	const value = (process.env.SENTRY_CRONS || 'mondayPayouts').trim();
	return value === 'all' ? null : new Set(value.split(',').map((s) => s.trim()).filter(Boolean));
};

/**
 * Tâches planifiées surveillées par Sentry Crons. Le moniteur est créé automatiquement au premier
 * passage, avec l'heure prévue : un passage manqué ou en échec déclenche une alerte.
 */
const monitorCrons = (tasks) => {
	if (!DSN) return tasks;
	const only = monitoredCrons();
	return Object.fromEntries(
		Object.entries(tasks).map(([name, definition]) => {
			if (only && !only.has(name)) return [name, definition];
			const slug = name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
			return [
				name,
				{
					...definition,
					task: (args) =>
						Sentry.withMonitor(slug, () => definition.task(args), {
							schedule: { type: 'crontab', value: definition.options.rule },
							timezone: definition.options.tz || 'Europe/Paris',
							checkinMargin: 10,
							maxRuntime: 60,
						}),
				},
			];
		})
	);
};

module.exports = { init, captureError, hookLogger, monitorCrons, scrubEvent, Sentry };
