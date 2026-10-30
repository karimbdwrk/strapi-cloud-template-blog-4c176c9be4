'use strict';

/**
 * appointment controller (rendez-vous : contient des données de santé)
 *
 * Lecture
 * - GET /appointments/busy : créneaux pris d'un praticien (horaires seulement), public,
 *   pour le calcul des disponibilités. Aucune donnée de patient.
 * - find / findOne : uniquement les rendez-vous dont on est le patient ou le praticien.
 *   Le patient (relation vers User) est ajouté côté serveur, avec son dossier.
 * Écriture
 * - create : contrôles serveur (praticien en ligne, créneau dans ses horaires et libre,
 *   dossier patient complet) ; le patient est toujours le compte connecté.
 * - update : patient ou praticien du rendez-vous, chacun limité à ses champs.
 * - delete : SuperAdmin uniquement.
 * Paiement (src/payments.js) : un rendez-vous pris en ligne par un patient est payé à la
 * réservation ; il reste « en attente de paiement » (masqué des listes) jusqu'au paiement.
 * Le SuperAdmin garde un accès complet.
 */

const { createCoreController } = require('@strapi/strapi').factories;
const { slotKeyFor, isUniqueViolation } = require('../../../appointment-slots');
const payments = require('../../../payments');

const UID = 'api::appointment.appointment';
const DOCTOR_UID = 'api::doctor.doctor';
const RECORD_UID = 'api::user-record.user-record';
const ADMIN_ROLE = 'SuperAdmin';
const TIME_ZONE = 'Europe/Paris';
const DEFAULT_DURATION = 30;
const WEEK_DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const DOCTOR_DOCS = ['document1', 'document2', 'document3', 'document4', 'document5', 'document6'];
const PATIENT_DOCS = ['docFromPatientA', 'docFromPatientB', 'docFromPatientC', 'docFromPatientD', 'docFromPatientE', 'docFromPatientF'];

// Champs modifiables par chacun sur un rendez-vous existant
const PATIENT_FIELDS = ['note', 'isCancelled', ...PATIENT_DOCS];
const DOCTOR_FIELDS = ['doctorNote', 'visioLink', 'isOver', 'isCancelled', 'isPaid', ...DOCTOR_DOCS];

const isAdmin = (user) => user?.role?.name === ADMIN_ROLE;

// « Non annulé » : false ou vide. Un simple $ne: true exclurait aussi les valeurs NULL en SQL.
const NOT_CANCELLED = { $or: [{ isCancelled: false }, { isCancelled: { $null: true } }] };
// Réservations non encore payées : invisibles dans les listes (elles bloquent seulement le créneau)
const NOT_PENDING = { $or: [{ paymentStatus: { $ne: 'pending' } }, { paymentStatus: { $null: true } }] };
// Champs de paiement : fixés par le serveur uniquement
const PAYMENT_INPUT = ['price', 'paymentStatus', 'paidAt', 'refundedAt', 'paidOutAt', 'isPaid', 'invoiceNumber', 'invoiceUrl', 'creditNoteUrl'];

// populate=* ou toute demande qui inclut la relation patient (patient, patient.user_record…)
const wantsPatient = (populate) =>
	populate === '*' || /(^|[^A-Za-z])patient([^A-Za-z]|$)/.test(JSON.stringify(populate ?? ''));

// Champs du patient transmis au praticien : identité, contact et dossier (jamais le mot de passe, le rôle…)
const PATIENT_POPULATE = {
	fields: ['id', 'documentId', 'firstname', 'lastname', 'email'],
	populate: {
		user_record: {
			fields: ['documentId', 'firstname', 'lastname', 'phone'],
			populate: {
				healthRecord: true,
				addressUser: true,
				healthInformations: true,
				languages: { fields: ['title', 'code'] },
			},
		},
	},
};

/** Rendez-vous accessibles : ceux dont on est le patient ou le praticien. */
const ownedBy = (user) => ({
	$or: [{ patient: { id: user.id } }, { doctor: { users_permissions_user: { id: user.id } } }],
});

/** Rôle du compte sur un rendez-vous : 'patient' | 'doctor' | null */
const roleOn = async (strapi, documentId, user) => {
	const a = await strapi.documents(UID).findOne({
		documentId,
		fields: ['id'],
		populate: {
			patient: { fields: ['id'] },
			doctor: { fields: ['id'], populate: { users_permissions_user: { fields: ['id'] } } },
		},
	});
	if (!a) return null;
	if (a.doctor?.users_permissions_user?.id === user.id) return 'doctor';
	if (a.patient?.id === user.id) return 'patient';
	return null;
};

/** Ajoute le patient aux rendez-vous dont le demandeur est le praticien ou le patient. */
const attachPatients = async (strapi, appointments, user) => {
	const list = (Array.isArray(appointments) ? appointments : [appointments]).filter(Boolean);
	const ids = list.map((a) => a.documentId).filter(Boolean);
	if (!ids.length) return;

	const rows = await strapi.documents(UID).findMany({
		filters: { documentId: { $in: ids } },
		fields: ['documentId'],
		populate: {
			doctor: { fields: ['id'], populate: { users_permissions_user: { fields: ['id'] } } },
			patient: PATIENT_POPULATE,
		},
		limit: ids.length,
	});
	const byId = new Map(rows.map((r) => [r.documentId, r]));

	for (const appointment of list) {
		const row = byId.get(appointment.documentId);
		const patient = row?.patient;
		if (!patient) continue;
		const isOwnDoctor = row.doctor?.users_permissions_user?.id === user.id;
		const isPatient = patient.id === user.id;
		if (isOwnDoctor || isPatient) appointment.patient = patient;
	}
};

/**
 * isRated : le patient sait s'il a déjà évalué le rendez-vous. L'avis lui-même n'est pas renvoyé
 * (lecture des avis réservée à l'admin) et le praticien ne reçoit pas cette information.
 */
const attachRated = async (strapi, appointments, user) => {
	const list = (Array.isArray(appointments) ? appointments : [appointments]).filter(Boolean);
	const ids = list.map((a) => a.documentId).filter(Boolean);
	if (!ids.length) return;

	const rows = await strapi.db.query(UID).findMany({
		where: { documentId: { $in: ids } },
		select: ['documentId'],
		populate: { patient: { select: ['id'] }, rating: { select: ['id'] } },
	});
	const byId = new Map(rows.map((r) => [r.documentId, r]));
	for (const appointment of list) {
		const row = byId.get(appointment.documentId);
		if (row?.patient?.id === user.id) appointment.isRated = Boolean(row.rating);
	}
};

/* ---------- Contrôles de réservation ---------- */

/** Praticien qui ne reçoit que des femmes ou que des hommes : message si la personne consultée ne correspond pas */
const wrongGender = (doctor, gender) => {
	if (doctor.onlyWomen && gender === 'man') return 'Ce praticien reçoit uniquement des femmes.';
	if (doctor.onlyMen && gender === 'woman') return 'Ce praticien reçoit uniquement des hommes.';
	return null;
};

/** Heure locale (Paris) d'une date : { day: 'monday', minutes: 570, date: '2026-10-28' } */
const localParts = (date) => {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat('en-GB', {
			timeZone: TIME_ZONE,
			weekday: 'long',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			hourCycle: 'h23',
		})
			.formatToParts(date)
			.map((p) => [p.type, p.value])
	);
	return {
		day: parts.weekday.toLowerCase(),
		minutes: Number(parts.hour) * 60 + Number(parts.minute),
		date: `${parts.year}-${parts.month}-${parts.day}`,
	};
};

/** « 09:30:00.000 » → 570 */
const toMinutes = (time) => {
	if (!time || typeof time !== 'string') return null;
	const [h, m] = time.split(':').map(Number);
	return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
};

/** Praticien visé par la réservation (id numérique, documentId ou { connect }) */
const findDoctor = (strapi, value) => {
	const ref = value?.connect?.[0] ?? value?.set?.[0] ?? value;
	const key = ref?.documentId ?? ref?.id ?? ref;
	if (key === undefined || key === null || key === '') return null;
	const where = typeof key === 'number' || /^\d+$/.test(String(key)) ? { id: Number(key) } : { documentId: String(key) };
	return strapi.db.query(DOCTOR_UID).findOne({
		where,
		select: ['id', 'documentId', 'isActive', 'onlyWomen', 'onlyMen', 'onlyPhone', 'plan', 'stripeAccountId', 'paymentsEnabled'],
		populate: {
			users_permissions_user: { select: ['id'] },
			reason: true,
			priceRange: true,
			holidays: true,
			...Object.fromEntries(WEEK_DAYS.map((d) => [d, true])),
		},
	});
};

/** Message d'erreur si le créneau est hors des horaires du praticien, sinon null. */
const outsideSchedule = (doctor, start, duration) => {
	const local = localParts(start);
	const day = doctor[local.day];
	if (!day || day.isOff) return 'Le praticien ne consulte pas ce jour-là.';

	const open = toMinutes(day.startTime);
	const close = toMinutes(day.endTime);
	if (open === null || close === null) return 'Le praticien n’a pas d’horaires ce jour-là.';
	if (local.minutes < open || local.minutes >= close) return 'Ce créneau est en dehors des horaires du praticien.';

	const pauseStart = toMinutes(day.startBreak);
	const pauseEnd = toMinutes(day.endBreak);
	if (pauseStart !== null && pauseEnd !== null && local.minutes < pauseEnd && local.minutes + duration > pauseStart) {
		return 'Ce créneau tombe pendant la pause du praticien.';
	}

	const onHoliday = (doctor.holidays || []).some((h) => h.start && h.end && local.date >= h.start && local.date <= h.end);
	if (onHoliday) return 'Le praticien est absent à cette date.';
	return null;
};

/**
 * Mode du créneau (physical | online | both). L'après-midi commence à la fin de la pause,
 * ou à splitTime quand la journée est scindée sans pause.
 * Journées enregistrées avant les demi-journées : isOnline fait foi.
 */
const modeAt = (day, minutes) => {
	const legacy = day.isOnline ? 'online' : 'physical';
	const morning = day.morningMode || legacy;
	const afternoon = day.afternoonMode || morning;
	const pauseEnd = toMinutes(day.endBreak);
	const boundary = toMinutes(day.startBreak) !== null && pauseEnd !== null ? pauseEnd : toMinutes(day.splitTime);
	return boundary !== null && minutes >= boundary ? afternoon : morning;
};

/** Message d'erreur si le mode demandé (visio ou cabinet) n'est pas proposé sur ce créneau, sinon null. */
const wrongMode = (doctor, start, isOnline) => {
	const local = localParts(start);
	const mode = modeAt(doctor[local.day], local.minutes);
	if (mode === 'online' && !isOnline) return 'Ce créneau est réservé aux consultations en visio.';
	if (mode === 'physical' && isOnline) return 'Ce créneau se déroule uniquement au cabinet.';
	return null;
};

/** Vrai si un rendez-vous non annulé du praticien chevauche ce créneau. */
const slotTaken = async (strapi, doctorId, start, duration) => {
	const from = new Date(start.getTime() - 12 * 3600000);
	const to = new Date(start.getTime() + 12 * 3600000);
	const existing = await strapi.db.query(UID).findMany({
		where: {
			$and: [{ doctor: { id: doctorId } }, NOT_CANCELLED, { datetime: { $gte: from, $lte: to } }],
		},
		select: ['datetime', 'duration'],
	});
	const end = start.getTime() + duration * 60000;
	return existing.some((a) => {
		const s = new Date(a.datetime).getTime();
		const e = s + (Number(a.duration) || DEFAULT_DURATION) * 60000;
		return s < end && start.getTime() < e;
	});
};

/** Remboursement avant annulation ; null (et réponse d'erreur) si Stripe refuse */
const refundBeforeCancel = async (ctx, { byPatient }) => {
	try {
		return await payments.refundOnCancel(strapi, ctx.params.id, { byPatient });
	} catch (error) {
		strapi.log.error(`Paiements : remboursement de ${ctx.params.id} impossible (${error.message})`);
		ctx.status = 502;
		ctx.body = { error: { status: 502, message: 'Le remboursement n’a pas pu être effectué. Réessayez ou contactez le support.' } };
		return null;
	}
};

module.exports = createCoreController(UID, ({ strapi }) => ({
	/**
	 * GET /appointments/busy?doctor=<id|documentId>&date=AAAA-MM-JJ (date facultative)
	 * Créneaux pris d'un praticien, sans aucune donnée de patient. Route publique.
	 */
	async busy(ctx) {
		const doctorRef = ctx.query?.doctor;
		if (!doctorRef) return ctx.badRequest('Paramètre « doctor » manquant');
		const doctorWhere = /^\d+$/.test(String(doctorRef)) ? { id: Number(doctorRef) } : { documentId: String(doctorRef) };

		const date = typeof ctx.query?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ctx.query.date) ? ctx.query.date : null;
		const where = {
			$and: [
				{ doctor: doctorWhere },
				NOT_CANCELLED,
				date ? { date } : { datetime: { $gte: new Date(Date.now() - 24 * 3600000) } },
			],
		};
		const rows = await strapi.db.query(UID).findMany({
			where,
			select: ['date', 'datetime', 'duration'],
			orderBy: { datetime: 'asc' },
			limit: 2000,
		});
		return { data: rows.map(({ date: d, datetime, duration }) => ({ date: d, datetime, duration })) };
	},

	async find(ctx) {
		const user = ctx.state.user;
		if (isAdmin(user)) return super.find(ctx);
		if (!user) return ctx.unauthorized();

		// Filtre « mes rendez-vous » (patient) : imposé côté serveur, Strapi refuserait le filtre sur User
		const filters = ctx.query?.filters;
		const forcePatient = Boolean(filters && typeof filters === 'object' && 'patient' in filters);
		if (forcePatient) {
			const { patient, ...otherFilters } = filters;
			ctx.query = { ...ctx.query, filters: otherFilters };
		}
		const withPatient = wantsPatient(ctx.query?.populate);

		await this.validateQuery(ctx);
		const sanitizedQuery = await this.sanitizeQuery(ctx);
		const { results, pagination } = await strapi.service(UID).find({
			...sanitizedQuery,
			filters: {
				$and: [
					sanitizedQuery.filters || {},
					forcePatient ? { patient: { id: user.id } } : ownedBy(user),
					NOT_PENDING,
				],
			},
		});
		const sanitizedResults = await this.sanitizeOutput(results, ctx);
		if (withPatient) await attachPatients(strapi, sanitizedResults, user);
		await attachRated(strapi, sanitizedResults, user);
		return this.transformResponse(sanitizedResults, { pagination });
	},

	async findOne(ctx) {
		const user = ctx.state.user;
		if (isAdmin(user)) return super.findOne(ctx);
		if (!user) return ctx.unauthorized();
		if (!(await roleOn(strapi, ctx.params.id, user))) return ctx.notFound();

		const withPatient = wantsPatient(ctx.query?.populate);
		const response = await super.findOne(ctx);
		if (withPatient && response?.data) await attachPatients(strapi, response.data, user);
		if (response?.data) await attachRated(strapi, response.data, user);
		return response;
	},

	/**
	 * POST /appointments
	 * - patient : praticien en ligne, créneau dans ses horaires, libre et à venir, dossier complet ;
	 * - praticien dans son propre agenda : créneau libre (horaires libres : il peut ajouter un rendez-vous exceptionnel).
	 * Le patient est rattaché dans la création même : les notifications partent juste après et le lisent.
	 */
	async create(ctx) {
		const user = ctx.state.user;
		if (!user) return ctx.unauthorized();
		if (isAdmin(user)) return super.create(ctx);

		const body = ctx.request.body || {};
		const data = { ...(body.data || {}) };
		const forConnectedPatient = 'patient' in data;
		delete data.patient;
		for (const field of PAYMENT_INPUT) delete data[field];

		const doctor = await findDoctor(strapi, data.doctor);
		if (!doctor) return ctx.badRequest('Praticien introuvable.');
		const inOwnAgenda = doctor.users_permissions_user?.id === user.id;

		const start = new Date(data.datetime);
		if (isNaN(start.getTime())) return ctx.badRequest('Date du rendez-vous invalide.');
		const duration = Number(data.duration) > 0 ? Number(data.duration) : DEFAULT_DURATION;

		if (inOwnAgenda) {
			data.isFromDoctor = true;
		} else {
			data.isFromDoctor = false;
			if (!doctor.isActive) return ctx.badRequest('Ce praticien ne prend pas de rendez-vous pour le moment.');
			// Offre Essentiel (ou choix du praticien) : rendez-vous par téléphone uniquement
			if (doctor.plan !== 'premium' || doctor.onlyPhone) {
				return ctx.badRequest('Ce praticien prend ses rendez-vous par téléphone.');
			}
			if (start.getTime() < Date.now()) return ctx.badRequest('Ce créneau est déjà passé.');
			const record = await strapi.db.query(RECORD_UID).findOne({
				where: { users_permissions_user: { id: user.id }, isActive: true },
				select: ['id'],
				populate: { healthRecord: { select: ['gender'] } },
			});
			if (!record) return ctx.forbidden('Complétez votre profil avant de prendre rendez-vous.');
			// Personne consultée : le proche s'il est renseigné, sinon le patient connecté
			const genderError = data.someoneElse?.firstname
				? wrongGender(doctor, data.someoneElse.gender)
				: wrongGender(doctor, record.healthRecord?.gender);
			if (genderError) return ctx.badRequest(genderError);
			const scheduleError = outsideSchedule(doctor, start, duration);
			if (scheduleError) return ctx.badRequest(scheduleError);
			const modeError = wrongMode(doctor, start, Boolean(data.isOnline));
			if (modeError) return ctx.badRequest(modeError);
		}

		if (await slotTaken(strapi, doctor.id, start, duration)) {
			return ctx.conflict
				? ctx.conflict('Ce créneau vient d’être réservé. Choisissez-en un autre.')
				: ctx.badRequest('Ce créneau vient d’être réservé. Choisissez-en un autre.');
		}

		// Réservation en ligne d'un patient : payée au prix du motif choisi, si le praticien encaisse en ligne
		const price = inOwnAgenda ? null : payments.priceFor(doctor, data.reason);

		ctx.request.body = { ...body, data };
		await this.validateQuery(ctx);
		const sanitizedQuery = await this.sanitizeQuery(ctx);
		await this.validateInput(data, ctx);
		const sanitizedInput = await this.sanitizeInput(data, ctx);

		let entity;
		try {
			entity = await strapi.service(UID).create({
				...sanitizedQuery,
				data: {
					...sanitizedInput,
					...(forConnectedPatient && !inOwnAgenda && { patient: user.id }),
					// Verrou en base : une seconde réservation simultanée du même créneau est refusée
					slotKey: slotKeyFor(doctor.id, start),
					...(price && payments.pendingPaymentData(price, doctor)),
				},
			});
		} catch (error) {
			if (isUniqueViolation(error)) {
				return ctx.conflict
					? ctx.conflict('Ce créneau vient d’être réservé. Choisissez-en un autre.')
					: ctx.badRequest('Ce créneau vient d’être réservé. Choisissez-en un autre.');
			}
			throw error;
		}
		let payment = null;
		if (price) {
			try {
				payment = await payments.startPayment(strapi, entity, { doctor, user });
			} catch (error) {
				// Paiement impossible à préparer : la réservation est retirée, le créneau libéré
				strapi.log.error(`Paiements : réservation ${entity.documentId} sans paiement (${error.message})`);
				await strapi.db.query(UID).delete({ where: { id: entity.id } });
				ctx.status = 502;
				ctx.body = { error: { status: 502, message: 'Le paiement n’a pas pu être préparé. Réessayez dans un instant.' } };
				return;
			}
		}
		const sanitizedEntity = await this.sanitizeOutput(entity, ctx);
		ctx.status = 201;
		return this.transformResponse(sanitizedEntity, payment ? { payment } : undefined);
	},

	/** POST /appointments/:id/confirm-payment : le patient a payé dans le formulaire */
	async confirmPayment(ctx) {
		const user = ctx.state.user;
		if (!user) return ctx.unauthorized();
		try {
			ctx.body = { data: await payments.confirmPayment(strapi, user, ctx.params.id) };
		} catch (error) {
			ctx.status = error.status || 502;
			ctx.body = { error: { status: ctx.status, message: error.expose ? error.message : 'Le paiement n’a pas pu être vérifié.' } };
		}
	},

	/** POST /appointments/:id/abandon : paiement fermé sans payer, le créneau est libéré */
	async abandonPayment(ctx) {
		const user = ctx.state.user;
		if (!user) return ctx.unauthorized();
		try {
			await payments.abandonPayment(strapi, user, ctx.params.id);
		} catch (error) {
			strapi.log.error(`Paiements : abandon de ${ctx.params.id} (${error.message})`);
		}
		ctx.status = 204;
	},

	/** PUT /appointments/:id : patient ou praticien du rendez-vous, chacun limité à ses champs. */
	async update(ctx) {
		const user = ctx.state.user;
		if (isAdmin(user)) {
			const adminData = ctx.request.body?.data || {};
			if (adminData.isCancelled === true) {
				const refund = await refundBeforeCancel(ctx, { byPatient: adminData.isCancelledByPatient === true });
				if (!refund) return;
				ctx.request.body = { ...ctx.request.body, data: { ...adminData, ...refund } };
			}
			return super.update(ctx);
		}
		if (!user) return ctx.unauthorized();

		const role = await roleOn(strapi, ctx.params.id, user);
		if (!role) return ctx.forbidden('Vous ne pouvez modifier que vos propres rendez-vous.');

		const allowed = role === 'doctor' ? DOCTOR_FIELDS : PATIENT_FIELDS;
		const body = ctx.request.body || {};
		const data = Object.fromEntries(Object.entries(body.data || {}).filter(([key]) => allowed.includes(key)));
		if (!Object.keys(data).length) return ctx.badRequest('Aucune modification autorisée dans cette demande.');
		// L'auteur de l'annulation est fixé par le serveur (il détermine qui est prévenu)
		if (data.isCancelled === true) data.isCancelledByPatient = role === 'patient';
		if ('isPaid' in data || 'isOver' in data) {
			const current = await strapi.db.query(UID).findOne({
				where: { documentId: ctx.params.id },
				select: ['paymentStatus', 'datetime', 'paidOutAt'],
			});
			// « Payé » se coche pour un règlement au cabinet, pas pour une consultation payée en ligne
			if (current?.paymentStatus && current.paymentStatus !== 'none') delete data.isPaid;
			// La clôture par le praticien valide la consultation et déclenche son versement le lundi
			if (data.isOver === true && current?.datetime && new Date(current.datetime) > new Date()) {
				return ctx.badRequest('Vous pourrez clôturer ce rendez-vous une fois la consultation commencée.');
			}
			if (data.isOver === false && current?.paidOutAt) delete data.isOver;
		}
		// Remboursement éventuel avant l'annulation (règle des 24 h pour le patient)
		if (data.isCancelled === true) {
			const refund = await refundBeforeCancel(ctx, { byPatient: role === 'patient' });
			if (!refund) return;
			Object.assign(data, refund);
		}

		ctx.request.body = { ...body, data };
		return super.update(ctx);
	},

	async delete(ctx) {
		if (!isAdmin(ctx.state.user)) return ctx.forbidden();
		return super.delete(ctx);
	},

	/**
	 * GET /appointments/to-rate-count
	 * Nombre de rendez-vous terminés que le patient connecté n'a pas encore évalués.
	 */
	async toRateCount(ctx) {
		const user = ctx.state.user;
		if (!user) return ctx.unauthorized();

		const count = await strapi.documents(UID).count({
			filters: {
				$and: [{ patient: { id: user.id } }, { isOver: true }, NOT_CANCELLED, { rating: { id: { $null: true } } }],
			},
		});
		return { data: { count } };
	},
}));
