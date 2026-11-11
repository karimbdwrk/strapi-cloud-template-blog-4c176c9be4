'use strict';

/**
 * Rappels automatiques des rendez-vous (tâches planifiées, config/cron-tasks.js).
 *
 * - Patient : rappel environ 24 heures avant le rendez-vous (notification + email
 *   « appointment_reminder »). Pas de rappel pour un rendez-vous pris moins de 6 heures plus tôt :
 *   l'email de confirmation vient de partir.
 * - Praticien : chaque consultation terminée et pas encore clôturée donne une notification
 *   « appointment_to_close » (une fois), et un seul email récapitulatif par jour. Le dimanche,
 *   relance des consultations payées non clôturées : elles ne partent pas au virement du lundi.
 *
 * Chaque notification a une clé anti-doublon : relancer une tâche n'envoie rien deux fois.
 */

const { TIME_ZONE, formatWhen, fullName, notifier } = require('./notifications/helpers');
const { loadAppointment } = require('./notifications/appointments');
const { patientReminderEmail, doctorToCloseEmail } = require('./notifications/appointment-emails');
const { netCents } = require('./payments');

const UID = 'api::appointment.appointment';
const NOTIFICATION = 'api::notification.notification';
const HOUR = 3600 * 1000;
const DEFAULT_DURATION = 30;

// Rappel patient
const REMINDER_WINDOW = 24 * HOUR;
const RECENTLY_BOOKED = 6 * HOUR;
// Rappel de clôture : 1 heure après la fin, consultations des 30 derniers jours seulement
// (pas de relance sans fin pour un ancien rendez-vous oublié)
const CLOSE_DELAY = HOUR;
const CLOSE_LOOKBACK = 30 * 24 * HOUR;

// Champs booléens et statut parfois vides sur les anciens rendez-vous : null = valeur par défaut
const NOT_CANCELLED = { $or: [{ isCancelled: false }, { isCancelled: { $null: true } }] };
const NOT_OVER = { $or: [{ isOver: false }, { isOver: { $null: true } }] };
const NOT_PENDING = { $or: [{ paymentStatus: { $ne: 'pending' } }, { paymentStatus: { $null: true } }] };

/** Jour civil à Paris, « 2026-11-11 » */
const parisDay = (date) => new Date(date).toLocaleDateString('fr-CA', { timeZone: TIME_ZONE });

/** Clés anti-doublon déjà utilisées parmi `keys` */
const existingKeys = async (strapi, keys) => {
	if (!keys.length) return new Set();
	const rows = await strapi.db.query(NOTIFICATION).findMany({
		where: { dedupeKey: { $in: keys } },
		select: ['dedupeKey'],
	});
	return new Set(rows.map((row) => row.dedupeKey));
};

/* ------------------------------------------------------------------ */
/* Rappel au patient                                                   */
/* ------------------------------------------------------------------ */

const sendPatientReminders = async (strapi, now = new Date()) => {
	const rows = await strapi.db.query(UID).findMany({
		where: {
			$and: [
				{ datetime: { $gt: now, $lte: new Date(now.getTime() + REMINDER_WINDOW) } },
				{ createdAt: { $lt: new Date(now.getTime() - RECENTLY_BOOKED) } },
				{ patient: { id: { $notNull: true } } },
				NOT_CANCELLED,
				NOT_PENDING,
			],
		},
		select: ['documentId'],
		limit: 1000,
	});
	const done = await existingKeys(strapi, rows.map((r) => `appointment_reminder:${r.documentId}`));
	const today = parisDay(now);
	let sent = 0;

	for (const { documentId } of rows) {
		if (done.has(`appointment_reminder:${documentId}`)) continue;
		try {
			const a = await loadAppointment(strapi, documentId);
			if (!a?.patient?.id || a.isCancelled) continue;
			const dayWord = parisDay(a.datetime) === today ? 'aujourd’hui' : 'demain';
			const time = new Date(a.datetime).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: TIME_ZONE });
			const created = await notifier(strapi).notify({
				recipient: a.patient.id,
				type: 'appointment_reminder',
				title: `Rappel : rendez-vous ${dayWord} à ${time}`,
				body: `Avec ${fullName(a.doctor) || 'votre praticien'} · ${a.isOnline ? 'Visioconférence' : 'Cabinet'}`,
				link: `/appointment/${a.UUID}`,
				appointment: a.documentId,
				dedupeKey: `appointment_reminder:${a.documentId}`,
				email: patientReminderEmail(a, dayWord),
			});
			if (created) sent += 1;
		} catch (error) {
			strapi.log.error(`Rappels : rendez-vous ${documentId} non rappelé (${error.message})`);
		}
	}
	if (sent) strapi.log.info(`Rappels : ${sent} rappel(s) de rendez-vous envoyé(s)`);
	return sent;
};

/* ------------------------------------------------------------------ */
/* Rappel de clôture au praticien                                      */
/* ------------------------------------------------------------------ */

const endOf = (a) => new Date(a.datetime).getTime() + (Number(a.duration) || DEFAULT_DURATION) * 60000;

const consultedName = (a) => fullName(a.someoneElse?.firstname ? a.someoneElse : a.patient) || 'Patient';

const sendCloseReminders = async (strapi, now = new Date()) => {
	const rows = await strapi.db.query(UID).findMany({
		where: {
			$and: [
				{ datetime: { $gt: new Date(now.getTime() - CLOSE_LOOKBACK), $lt: new Date(now.getTime() - CLOSE_DELAY) } },
				NOT_CANCELLED,
				NOT_OVER,
				NOT_PENDING,
			],
		},
		select: ['id', 'documentId', 'UUID', 'datetime', 'duration', 'price', 'paymentStatus'],
		populate: {
			patient: { select: ['firstname', 'lastname'] },
			someoneElse: true,
			doctor: { select: ['id', 'firstname'], populate: { users_permissions_user: { select: ['id'] } } },
		},
		orderBy: { datetime: 'asc' },
		limit: 5000,
	});

	// Consultations terminées depuis au moins une heure, regroupées par praticien
	const byDoctor = new Map();
	for (const a of rows) {
		const userId = a.doctor?.users_permissions_user?.id;
		if (!userId || endOf(a) + CLOSE_DELAY > now.getTime()) continue;
		if (!byDoctor.has(userId)) byDoctor.set(userId, { firstname: a.doctor.firstname, appointments: [] });
		byDoctor.get(userId).appointments.push(a);
	}

	const all = [...byDoctor.values()].flatMap((d) => d.appointments);
	const done = await existingKeys(strapi, all.map((a) => `appointment_to_close:${a.documentId}`));
	const beforePayout = new Date(now).toLocaleDateString('en-US', { weekday: 'short', timeZone: TIME_ZONE }) === 'Sun';
	const n = notifier(strapi);
	let emails = 0;

	for (const [userId, { firstname, appointments }] of byDoctor) {
		try {
			const fresh = appointments.filter((a) => !done.has(`appointment_to_close:${a.documentId}`));
			for (const a of fresh) {
				await n.notify({
					recipient: userId,
					type: 'appointment_to_close',
					title: 'Rendez-vous à clôturer',
					body: `${consultedName(a)} · ${formatWhen(a.datetime)}`,
					link: `/appointment/${a.UUID}`,
					appointment: a.documentId,
					dedupeKey: `appointment_to_close:${a.documentId}`,
				});
			}

			const paid = appointments.filter((a) => a.paymentStatus === 'paid' && a.price);
			// Un email s'il y a du nouveau ; le dimanche, aussi s'il reste des consultations payées à verser
			if (!fresh.length && !(beforePayout && paid.length)) continue;

			await n.emailUser({
				recipient: userId,
				category: 'appointments',
				email: doctorToCloseEmail({
					firstname,
					appointments: appointments.map((a) => ({
						datetime: a.datetime,
						patientName: consultedName(a),
						paid: a.paymentStatus === 'paid',
					})),
					awaitingNet: paid.reduce((sum, a) => sum + netCents(a), 0) / 100,
					beforePayout: beforePayout && paid.length > 0,
				}),
			});
			emails += 1;
		} catch (error) {
			strapi.log.error(`Rappels : praticien (compte ${userId}) non relancé (${error.message})`);
		}
	}
	if (emails) strapi.log.info(`Rappels : ${emails} praticien(s) relancé(s) pour clôturer leurs consultations`);
	return emails;
};

module.exports = { sendPatientReminders, sendCloseReminders };
