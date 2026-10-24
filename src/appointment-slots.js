'use strict';

/**
 * Verrou de créneau contre les doubles réservations simultanées.
 *
 * Le contrôleur vérifie qu'un créneau est libre avant de créer le rendez-vous, mais deux
 * réservations envoyées au même instant peuvent passer ce contrôle ensemble. Chaque rendez-vous
 * actif porte donc une clé « praticien:heure de début » (champ privé slotKey) protégée par un
 * index unique en base : la seconde insertion est refusée par la base elle-même, avant toute
 * notification. Un rendez-vous annulé libère sa clé (NULL), le créneau redevient réservable.
 */

const UID = 'api::appointment.appointment';
const INDEX_NAME = 'appointments_slot_key_unique';

/** « 12:2026-10-28T09:00:00.000Z » */
const slotKeyFor = (doctorId, start) => `${doctorId}:${new Date(start).toISOString()}`;

/** Erreur d'unicité (PostgreSQL 23505, SQLite UNIQUE), éventuellement enveloppée par Strapi */
const isUniqueViolation = (error) => {
	const seen = new Set();
	for (let e = error; e && !seen.has(e); e = e.cause || e.originalError || e.details?.cause) {
		seen.add(e);
		if (e.code === '23505' || /UNIQUE constraint failed|duplicate key value/i.test(String(e.message || ''))) return true;
	}
	return false;
};

/** À l'annulation (site, API ou panneau d'administration), le créneau est libéré. */
const registerSlotRelease = (strapi) => {
	strapi.documents.use(async (context, next) => {
		if (context.uid === UID && context.action === 'update' && context.params?.data?.isCancelled === true) {
			context.params.data = { ...context.params.data, slotKey: null };
		}
		return next();
	});
};

/** Crée l'index unique s'il n'existe pas (les valeurs NULL ne se gênent pas entre elles). */
const ensureSlotIndex = async (strapi) => {
	try {
		const { tableName, attributes } = strapi.db.metadata.get(UID);
		const column = attributes.slotKey?.columnName || 'slot_key';
		await strapi.db.connection.raw(`CREATE UNIQUE INDEX IF NOT EXISTS ${INDEX_NAME} ON ${tableName} (${column})`);
	} catch (error) {
		// Sans l'index, le contrôle applicatif reste en place : on signale sans bloquer le démarrage
		strapi.log.error(`[appointments] Index unique des créneaux non créé : ${error.message}`);
	}
};

module.exports = { slotKeyFor, isUniqueViolation, registerSlotRelease, ensureSlotIndex };
