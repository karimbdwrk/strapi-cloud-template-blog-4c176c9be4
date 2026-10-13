'use strict';

// Fuseau des textes de notification (les dates sont stockées en UTC)
const TIME_ZONE = 'Europe/Paris';

const fullName = (p) => [p?.lastname, p?.firstname].filter(Boolean).join(' ');

/** « mardi 14 octobre à 09:30 » */
const formatWhen = (iso) => {
	if (!iso) return '';
	const d = new Date(iso);
	const day = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TIME_ZONE });
	const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: TIME_ZONE });
	return `${day} à ${time}`;
};

/** « 14 oct. » */
const formatShortDate = (iso) =>
	iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: TIME_ZONE }) : '';

const today = () => new Date().toISOString().slice(0, 10);

const notifier = (strapi) => strapi.service('api::notification.notification');

module.exports = { TIME_ZONE, fullName, formatWhen, formatShortDate, today, notifier };
