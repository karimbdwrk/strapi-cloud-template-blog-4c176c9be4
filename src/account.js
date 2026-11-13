'use strict';

/**
 * Droits RGPD de l'utilisateur connecté, depuis son espace :
 *
 * - Export (droit d'accès et de portabilité) : toutes ses données dans un fichier JSON.
 * - Suppression (droit à l'effacement), confirmée par le mot de passe :
 *   - Patient : suppression immédiate. Le carnet de santé, les documents envoyés, les notes et
 *     motifs, les notifications, les demandes de support et l'inscription à la newsletter sont
 *     supprimés. Les rendez-vous passés et les avis restent (comptabilité et historique du
 *     praticien), sans lien avec la personne. Impossible tant qu'un rendez-vous à venir n'est pas
 *     annulé (son remboursement passe par l'annulation).
 *     Les factures de consultation, conservées par notre prestataire de paiement, restent : la loi
 *     impose de les garder 10 ans.
 *   - Praticien : abonnement, virements, factures et dossiers patients demandent un traitement
 *     manuel. La demande crée une demande de support, et l'équipe prévient l'administration.
 */

const { renderEmail, sendEmail } = require('./notifications/email');

const USER = 'plugin::users-permissions.user';
const APPOINTMENT = 'api::appointment.appointment';
const DOCTOR = 'api::doctor.doctor';
const TICKET = 'api::support-ticket.support-ticket';
const MESSAGE = 'api::support-message.support-message';

const PATIENT_DOCS = ['docFromPatientA', 'docFromPatientB', 'docFromPatientC', 'docFromPatientD', 'docFromPatientE', 'docFromPatientF'];
const DOCTOR_DOCS = ['document1', 'document2', 'document3', 'document4', 'document5', 'document6'];
const DELETION_SUBJECT = 'Suppression de mon compte praticien';

// Champs techniques ou secrets jamais exportés
const OMIT = new Set([
	'id',
	'password',
	'resetPasswordToken',
	'resetPasswordRequestedAt',
	'confirmationToken',
	'provider',
	'slotKey',
	'dedupeKey',
	'emailSentAt',
	'token',
	'visitorHash',
	'publishedAt',
	'locale',
	'paymentIntentId',
	'chargeId',
	'paymentAccountId',
	'payoutId',
	'invoiceId',
	'pendingUntil',
]);

const httpError = (status, message) => Object.assign(new Error(message), { status, expose: true });

/** Fichier → { nom, adresse } ; objets et listes nettoyés récursivement */
const clean = (value) => {
	if (Array.isArray(value)) return value.map(clean);
	if (!value || typeof value !== 'object' || value instanceof Date) return value;
	if (value.mime && value.url) return { name: value.name, url: value.url, type: value.mime };
	const out = {};
	for (const [key, v] of Object.entries(value)) {
		if (OMIT.has(key) || /^stripe/i.test(key)) continue;
		if (v === null || v === undefined || (Array.isArray(v) && !v.length)) continue;
		out[key] = clean(v);
	}
	return out;
};

const fullName = (p) => [p?.firstname, p?.lastname].filter(Boolean).join(' ') || null;

const doctorOfUser = (strapi, userId) =>
	strapi.db.query(DOCTOR).findOne({ where: { users_permissions_user: { id: userId } } });

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

const exportData = async (strapi, userId) => {
	const user = await strapi.db.query(USER).findOne({
		where: { id: userId },
		populate: {
			user_record: { populate: { languages: { select: ['title'] }, healthRecord: true, healthInformations: true, addressUser: true } },
			user_information: true,
		},
	});
	if (!user) throw httpError(404, 'Compte introuvable.');

	const [appointments, ratings, notifications, tickets, reportings, newsletter, doctor] = await Promise.all([
		strapi.db.query(APPOINTMENT).findMany({
			where: { patient: { id: userId } },
			populate: {
				doctor: { select: ['firstname', 'lastname'] },
				category: { select: ['name'] },
				someoneElse: true,
				appointmentAddress: true,
				...Object.fromEntries([...PATIENT_DOCS, ...DOCTOR_DOCS].map((k) => [k, true])),
			},
			orderBy: { datetime: 'desc' },
		}),
		strapi.db.query('api::rating.rating').findMany({
			where: { users_permissions_user: { id: userId } },
			populate: { doctor: { select: ['firstname', 'lastname'] } },
		}),
		strapi.db.query('api::notification.notification').findMany({
			where: { recipient: { id: userId } },
			select: ['title', 'body', 'type', 'link', 'readAt', 'createdAt'],
			orderBy: { createdAt: 'desc' },
		}),
		strapi.db.query(TICKET).findMany({
			where: { users_permissions_user: { id: userId } },
			populate: { support_messages: { select: ['body', 'fromAdmin', 'createdAt'] } },
		}),
		strapi.db.query('api::reporting.reporting').findMany({
			where: { patient: { id: userId } },
			select: ['from', 'reason', 'note', 'reportStatus', 'resolution', 'createdAt', 'closedAt'],
		}),
		strapi.db.query('api::newsletter.newsletter').findOne({
			where: { email: String(user.email || '').toLowerCase() },
			select: ['email', 'subscribedAt', 'unsubscribedAt'],
		}),
		doctorOfUser(strapi, userId),
	]);

	const data = {
		exportedAt: new Date().toISOString(),
		information:
			'Données associées à votre compte Meyana. Les factures de consultation sont disponibles dans votre espace.',
		account: clean({
			email: user.email,
			username: user.username,
			firstname: user.firstname,
			lastname: user.lastname,
			phone: user.phone,
			isDoctor: user.isDoctor,
			confirmed: user.confirmed,
			emailPreferences: user.emailPreferences,
			createdAt: user.createdAt,
			updatedAt: user.updatedAt,
		}),
		healthRecord: clean(user.user_record),
		identity: clean(user.user_information),
		appointments: appointments.map((a) =>
			clean({
				...a,
				doctor: fullName(a.doctor),
				category: a.category?.name,
				rating: undefined,
			})
		),
		ratingsGiven: ratings.map((r) => clean({ ...r, doctor: fullName(r.doctor), appointment: undefined, users_permissions_user: undefined })),
		notifications: notifications.map(clean),
		supportRequests: tickets.map((t) => clean({ ...t, users_permissions_user: undefined, appointment: undefined })),
		reports: reportings.map(clean),
		newsletter: clean(newsletter),
	};

	if (doctor) {
		const [full, articles, received, doctorAppointments] = await Promise.all([
			strapi.db.query(DOCTOR).findOne({
				where: { id: doctor.id },
				populate: {
					avatar: true,
					categories: { select: ['name'] },
					languages: { select: ['title'] },
					AddressDoctor: true,
					AddressGlobal: true,
					diplomas: true,
					experiences: true,
					priceRange: true,
					holidays: true,
					appointmentsData: true,
					keywords: { select: ['name'] },
					...Object.fromEntries(
						['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((d) => [d, true])
					),
				},
			}),
			strapi.db.query('api::article.article').findMany({
				where: { author: { id: doctor.id } },
				select: ['title', 'slug', 'description', 'content', 'createdAt', 'updatedAt'],
			}),
			strapi.db.query('api::rating.rating').findMany({
				where: { doctor: { id: doctor.id } },
				select: ['punctuality', 'respect', 'response', 'professionalism', 'listening', 'conditions', 'finalScore', 'note', 'createdAt'],
			}),
			strapi.db.query(APPOINTMENT).findMany({
				where: { doctor: { id: doctor.id } },
				select: ['datetime', 'duration', 'isCancelled', 'isOver', 'isOnline', 'price', 'paymentStatus', 'paidAt', 'refundedAt', 'invoiceNumber', 'doctorNote', 'createdAt'],
				populate: { patient: { select: ['firstname', 'lastname'] } },
				orderBy: { datetime: 'desc' },
			}),
		]);
		data.practitioner = {
			profile: clean({ ...full, users_permissions_user: undefined }),
			articles: articles.map(clean),
			ratingsReceived: received.map(clean),
			appointments: doctorAppointments.map((a) => clean({ ...a, patient: fullName(a.patient) })),
		};
	}

	return data;
};

/* ------------------------------------------------------------------ */
/* Suppression                                                         */
/* ------------------------------------------------------------------ */

const checkPassword = async (strapi, userId, password) => {
	const user = await strapi.db.query(USER).findOne({
		where: { id: userId },
		select: ['id', 'email', 'firstname', 'lastname', 'username', 'password', 'provider', 'isDoctor'],
		populate: { role: { select: ['name'] } },
	});
	if (!user) throw httpError(404, 'Compte introuvable.');
	if (user.role?.name === 'SuperAdmin') throw httpError(403, 'Un compte administrateur ne peut pas être supprimé depuis le site.');
	const ok =
		typeof password === 'string' &&
		password.length > 0 &&
		user.password &&
		(await strapi.plugin('users-permissions').service('user').validatePassword(password, user.password));
	if (!ok) throw Object.assign(httpError(400, 'Mot de passe incorrect.'), { field: 'password' });
	return user;
};

/** Praticien : demande de support (l'équipe est prévenue), une seule demande ouverte à la fois */
const requestDoctorDeletion = async (strapi, user, reason) => {
	const existing = await strapi.documents(TICKET).findFirst({
		filters: { users_permissions_user: { id: user.id }, subject: DELETION_SUBJECT, ticketStatus: { $ne: 'resolved' } },
	});
	if (existing) return { status: 'requested', ticket: existing.documentId, alreadyRequested: true };

	const ticket = await strapi.documents(TICKET).create({
		data: { subject: DELETION_SUBJECT, category: 'account', ticketStatus: 'open', lastMessageAt: new Date(), users_permissions_user: user.id },
	});
	const motif = String(reason || '').trim().slice(0, 1000);
	await strapi.documents(MESSAGE).create({
		data: {
			body: [
				'Je demande la suppression de mon compte praticien et de mes données.',
				motif && `Motif : ${motif}`,
				'(Demande envoyée depuis « Mes données », mot de passe confirmé.)',
			]
				.filter(Boolean)
				.join('\n\n'),
			fromAdmin: false,
			support_ticket: ticket.documentId,
			users_permissions_user: user.id,
		},
	});
	return { status: 'requested', ticket: ticket.documentId };
};

const deletePatient = async (strapi, user) => {
	const now = new Date();
	const upcoming = await strapi.db.query(APPOINTMENT).count({
		where: { patient: { id: user.id }, datetime: { $gt: now }, isCancelled: { $ne: true } },
	});
	if (upcoming) {
		throw httpError(
			409,
			upcoming === 1
				? 'Vous avez un rendez-vous à venir. Annulez-le d’abord depuis « Mes rendez-vous » (le remboursement éventuel passe par l’annulation).'
				: `Vous avez ${upcoming} rendez-vous à venir. Annulez-les d’abord depuis « Mes rendez-vous » (le remboursement éventuel passe par l’annulation).`
		);
	}

	// Rendez-vous passés : conservés pour le praticien et la comptabilité, détachés de la personne.
	// Documents envoyés par le patient, notes, motif et proche consulté : supprimés.
	const appointments = await strapi.db.query(APPOINTMENT).findMany({
		where: { patient: { id: user.id } },
		select: ['id'],
		populate: Object.fromEntries(PATIENT_DOCS.map((k) => [k, { select: ['id'] }])),
	});
	const upload = strapi.plugin('upload').service('upload');
	for (const appointment of appointments) {
		for (const key of PATIENT_DOCS) {
			const file = appointment[key];
			if (!file?.id) continue;
			const full = await strapi.db.query('plugin::upload.file').findOne({ where: { id: file.id } });
			if (full) await upload.remove(full).catch((error) => strapi.log.warn(`Suppression de compte : fichier ${file.id} non supprimé (${error.message})`));
		}
		await strapi.db.query(APPOINTMENT).update({
			where: { id: appointment.id },
			data: {
				patient: null,
				note: null,
				reason: null,
				someoneElse: null,
				...Object.fromEntries(PATIENT_DOCS.map((k) => [k, null])),
			},
		});
	}

	// Avis et signalements : gardés pour le praticien et la modération, sans auteur
	// (une par une : les relations ne se modifient pas en masse)
	const detach = async (uid, field) => {
		const rows = await strapi.db.query(uid).findMany({ where: { [field]: { id: user.id } }, select: ['id'] });
		for (const row of rows) await strapi.db.query(uid).update({ where: { id: row.id }, data: { [field]: null } });
	};
	await detach('api::rating.rating', 'users_permissions_user');
	await detach('api::reporting.reporting', 'patient');

	// Support, notifications, carnet de santé, identité, newsletter : supprimés
	const tickets = await strapi.db.query(TICKET).findMany({ where: { users_permissions_user: { id: user.id } }, select: ['id'] });
	if (tickets.length) {
		await strapi.db.query(MESSAGE).deleteMany({ where: { support_ticket: { id: { $in: tickets.map((t) => t.id) } } } });
		await strapi.db.query(TICKET).deleteMany({ where: { id: { $in: tickets.map((t) => t.id) } } });
	}
	await strapi.db.query(MESSAGE).deleteMany({ where: { users_permissions_user: { id: user.id } } });
	await strapi.db.query('api::notification.notification').deleteMany({ where: { recipient: { id: user.id } } });
	await strapi.db.query('api::user-record.user-record').deleteMany({ where: { users_permissions_user: { id: user.id } } });
	await strapi.db.query('api::userinformation.userinformation').deleteMany({ where: { user: { id: user.id } } });
	if (user.email) {
		await strapi.db.query('api::newsletter.newsletter').deleteMany({ where: { email: String(user.email).toLowerCase() } });
	}

	// Sessions fermées sur tous les appareils, puis compte supprimé
	try {
		await strapi.sessionManager?.('users-permissions')?.invalidateRefreshToken(String(user.id));
	} catch (error) {
		strapi.log.warn(`Suppression de compte : sessions non fermées (${error.message})`);
	}
	await strapi.db.query(USER).delete({ where: { id: user.id } });

	// Confirmation par email (le compte n'existe plus : envoi direct)
	if (user.email) {
		const { html, text } = renderEmail({
			title: 'Votre compte Meyana a été supprimé',
			paragraphs: [
				`Bonjour${user.firstname ? ` ${user.firstname}` : ''}, comme vous l’avez demandé, votre compte et vos données personnelles ont été supprimés.`,
				'Votre carnet de santé, vos documents, vos notes et vos échanges avec le support ont été effacés. Vos rendez-vous passés et vos avis restent visibles par les praticiens, sans votre nom.',
				'Les factures de vos consultations sont conservées 10 ans par notre prestataire de paiement, comme la loi l’impose.',
			],
			link: '/',
			cta: 'Revenir sur Meyana',
			footer: 'Vous recevez cet email car vous avez supprimé votre compte Meyana. Si vous n’êtes pas à l’origine de cette suppression, répondez à cet email.',
		});
		await sendEmail({ to: user.email, subject: 'Votre compte Meyana a été supprimé', html, text }).catch((error) =>
			strapi.log.warn(`Suppression de compte : email de confirmation non envoyé (${error.message})`)
		);
	}
	strapi.log.info(`Compte ${user.id} supprimé à la demande de l'utilisateur`);
	return { status: 'deleted' };
};

const deleteAccount = async (strapi, userId, { password, reason } = {}) => {
	const user = await checkPassword(strapi, userId, password);
	const doctor = user.isDoctor || (await doctorOfUser(strapi, user.id));
	if (doctor) return requestDoctorDeletion(strapi, user, reason);
	return deletePatient(strapi, user);
};

module.exports = { exportData, deleteAccount };
