'use strict';

/**
 * Notifications liées aux rendez-vous.
 *
 * Création
 *   - pris par le patient       → praticien : appointment_booked
 *                               → patient   : appointment_booked (confirmation)
 *   - ajouté par le praticien   → patient   : appointment_added_by_doctor
 * Mise à jour
 *   - annulation                → l'autre partie : appointment_cancelled
 *   - lien de visio ajouté      → patient : visio_link_added (une fois)
 *   - note du praticien         → patient : note_added (une fois par jour)
 *   - note du patient           → praticien : note_added (une fois par jour)
 *   - document du praticien     → patient : document_added
 *   - document du patient       → praticien : document_added
 *   - rendez-vous clôturé       → patient : review_request
 *
 * Aucune donnée de santé dans les textes (ni motif détaillé, ni contenu de note).
 */

const { fullName, formatWhen, today, notifier } = require('./helpers');
const {
	patientBookedEmail,
	doctorBookedEmail,
	patientCancelledOwnEmail,
	doctorCancelledOwnEmail,
} = require('./appointment-emails');

const UID = 'api::appointment.appointment';
const DOCTOR_DOCS = ['document1', 'document2', 'document3', 'document4', 'document5', 'document6'];
const PATIENT_DOCS = ['docFromPatientA', 'docFromPatientB', 'docFromPatientC', 'docFromPatientD', 'docFromPatientE', 'docFromPatientF'];

const loadAppointment = (strapi, documentId) =>
	strapi.documents(UID).findOne({
		documentId,
		populate: {
			patient: { fields: ['id', 'firstname', 'lastname'] },
			doctor: {
				fields: ['firstname', 'lastname', 'gender', 'UUID'],
				populate: { users_permissions_user: { fields: ['id'] }, priceRange: true, reason: true },
			},
			category: { fields: ['name', 'professionName', 'professionNameFeminine'] },
			appointmentAddress: true,
			someoneElse: true,
			rating: { fields: ['id'] },
		},
	});

const context = (a) => {
	const consulted = a.someoneElse?.firstname ? a.someoneElse : a.patient;
	return {
		link: `/appointment/${a.UUID}`,
		when: formatWhen(a.datetime),
		mode: a.isOnline ? 'Visioconférence' : 'Cabinet',
		doctorName: fullName(a.doctor) || 'votre praticien',
		patientName: fullName(consulted) || 'un patient',
		doctorUserId: a.doctor?.users_permissions_user?.id,
		patientUserId: a.patient?.id,
	};
};

const onCreate = async (strapi, created) => {
	const a = await loadAppointment(strapi, created.documentId);
	if (!a) return;
	const c = context(a);
	const n = notifier(strapi);

	if (a.isFromDoctor) {
		await n.notify({
			recipient: c.patientUserId,
			type: 'appointment_added_by_doctor',
			title: `Rendez-vous ajouté le ${c.when}`,
			body: `Avec ${c.doctorName} · ${c.mode}`,
			link: c.link,
			appointment: a.documentId,
			dedupeKey: `appointment_added_by_doctor:${a.documentId}`,
		});
		return;
	}

	await Promise.all([
		n.notify({
			recipient: c.doctorUserId,
			type: 'appointment_booked',
			title: `Nouveau rendez-vous le ${c.when}`,
			body: `Avec ${c.patientName} · ${c.mode}`,
			link: c.link,
			appointment: a.documentId,
			dedupeKey: `appointment_booked:doctor:${a.documentId}`,
			email: doctorBookedEmail(a),
		}),
		n.notify({
			recipient: c.patientUserId,
			type: 'appointment_booked',
			title: `Rendez-vous confirmé le ${c.when}`,
			body: `Avec ${c.doctorName} · ${c.mode}`,
			link: c.link,
			appointment: a.documentId,
			dedupeKey: `appointment_booked:patient:${a.documentId}`,
			email: patientBookedEmail(a),
		}),
	]);
};

const onUpdate = async (strapi, data, updated, previous) => {
	const a = await loadAppointment(strapi, updated.documentId);
	if (!a) return;
	const c = context(a);
	const n = notifier(strapi);
	const jobs = [];

	// Annulation
	if (data.isCancelled === true && !previous?.isCancelled) {
		const byPatient = Boolean(a.isCancelledByPatient);
		jobs.push(
			n.notify({
				recipient: byPatient ? c.doctorUserId : c.patientUserId,
				type: 'appointment_cancelled',
				title: `Rendez-vous du ${c.when} annulé`,
				body: byPatient ? `Annulé par ${c.patientName}` : `Annulé par ${c.doctorName}`,
				link: c.link,
				appointment: a.documentId,
				dedupeKey: `appointment_cancelled:${a.documentId}`,
			})
		);
		// Confirmation par email à celui qui a annulé (pas de notification : il vient de le faire)
		jobs.push(
			n.emailUser({
				recipient: byPatient ? c.patientUserId : c.doctorUserId,
				category: 'appointments',
				email: byPatient ? patientCancelledOwnEmail(a) : doctorCancelledOwnEmail(a),
			})
		);
	}

	// Lien de visio (première fois)
	if (typeof data.visioLink === 'string' && data.visioLink.trim() && !previous?.visioLink) {
		jobs.push(
			n.notify({
				recipient: c.patientUserId,
				type: 'visio_link_added',
				title: 'Le lien de visioconférence est disponible',
				body: `Rendez-vous du ${c.when} avec ${c.doctorName}`,
				link: c.link,
				appointment: a.documentId,
				dedupeKey: `visio_link_added:${a.documentId}`,
			})
		);
	}

	// Notes (au plus une notification par jour et par auteur)
	if (typeof data.doctorNote === 'string' && data.doctorNote.trim() && data.doctorNote !== previous?.doctorNote) {
		jobs.push(
			n.notify({
				recipient: c.patientUserId,
				type: 'note_added',
				title: `${c.doctorName} a laissé une note`,
				body: `Rendez-vous du ${c.when}`,
				link: c.link,
				appointment: a.documentId,
				dedupeKey: `note_added:doctor:${a.documentId}:${today()}`,
			})
		);
	}
	if (typeof data.note === 'string' && data.note.trim() && data.note !== previous?.note) {
		jobs.push(
			n.notify({
				recipient: c.doctorUserId,
				type: 'note_added',
				title: `${c.patientName} a laissé une note`,
				body: `Rendez-vous du ${c.when}`,
				link: c.link,
				appointment: a.documentId,
				dedupeKey: `note_added:patient:${a.documentId}:${today()}`,
			})
		);
	}

	// Documents ajoutés
	for (const [fields, recipient, author] of [
		[DOCTOR_DOCS, c.patientUserId, c.doctorName],
		[PATIENT_DOCS, c.doctorUserId, c.patientName],
	]) {
		for (const field of fields) {
			const fileId = data[field];
			if (fileId && fileId !== previous?.[field]) {
				jobs.push(
					n.notify({
						recipient,
						type: 'document_added',
						title: `Nouveau document de ${author}`,
						body: `Rendez-vous du ${c.when}`,
						link: c.link,
						appointment: a.documentId,
						dedupeKey: `document_added:${a.documentId}:${field}:${fileId}`,
					})
				);
			}
		}
	}

	// Clôture → demande d'avis (si pas encore noté)
	if (data.isOver === true && !previous?.isOver && !a.isCancelled && !a.rating) {
		jobs.push(
			n.notify({
				recipient: c.patientUserId,
				type: 'review_request',
				title: 'Comment s’est passé votre rendez-vous ?',
				body: `Donnez votre avis sur votre consultation avec ${c.doctorName}`,
				link: c.link,
				appointment: a.documentId,
				dedupeKey: `review_request:${a.documentId}`,
			})
		);
	}

	await Promise.all(jobs);
};

module.exports = {
	uids: [UID],

	/** Valeurs avant mise à jour, pour ne notifier que les vrais changements. */
	async before(strapi, context) {
		if (context.action !== 'update' || !context.params?.documentId) return null;
		const fields = ['isCancelled', 'isOver', 'visioLink', 'note', 'doctorNote'];
		const prev = await strapi.documents(UID).findOne({
			documentId: context.params.documentId,
			fields,
			populate: Object.fromEntries([...DOCTOR_DOCS, ...PATIENT_DOCS].map((f) => [f, { fields: ['id'] }])),
		});
		if (!prev) return null;
		const snapshot = Object.fromEntries(fields.map((f) => [f, prev[f]]));
		for (const f of [...DOCTOR_DOCS, ...PATIENT_DOCS]) snapshot[f] = prev[f]?.id ?? null;
		return snapshot;
	},

	async handle(strapi, context, result, previous) {
		if (!result?.documentId) return;
		if (context.action === 'create') return onCreate(strapi, result);
		if (context.action === 'update') return onUpdate(strapi, context.params?.data || {}, result, previous);
	},
};
