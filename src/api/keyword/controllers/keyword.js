'use strict';

/**
 * keyword controller
 *
 * - find / findOne : la liste Meyana (validée, globale) pour tous ; tout pour l'admin.
 * - mine / setMine / withdraw : mots-clés du praticien connecté (KEYWORD_LIMIT au plus,
 *   propositions en attente comprises). Une proposition part en modération ; elle n'est
 *   reliée au praticien qu'une fois validée (src/keywords.js).
 * - create / update / delete, moderation / moderate : admin uniquement. moderation et moderate
 *   lisent et écrivent les champs internes (auteur de la proposition, motif du refus),
 *   que Strapi retire des réponses REST classiques.
 */

const { createCoreController } = require('@strapi/strapi').factories;
const { KEYWORD_LIMIT, normalize, isMedical, canUseKeyword } = require('../../../keywords');

const UID = 'api::keyword.keyword';
const DOCTOR = 'api::doctor.doctor';
const ADMIN_ROLE = 'SuperAdmin';
const TYPES = ['symptom', 'reason', 'approach', 'audience'];
const FIELDS = ['name', 'synonyms', 'type', 'sensitive', 'global', 'status'];
const NAME_MIN = 2;
const NAME_MAX = 60;

const isAdmin = (user) => user?.role?.name === ADMIN_ROLE;

const view = (k) => ({
	id: k.id,
	documentId: k.documentId,
	name: k.name,
	synonyms: k.synonyms,
	type: k.type,
	sensitive: Boolean(k.sensitive),
	global: Boolean(k.global),
	status: k.status,
});

const PUBLIC_FILTERS = { status: 'approved', global: true };
const MODERATION_PAGE_SIZE = 25;
const EDITABLE = ['name', 'synonyms', 'type', 'sensitive', 'global', 'status', 'moderationNote'];

const moderationView = (k) => ({
	...view(k),
	moderationNote: k.moderationNote || null,
	moderatedAt: k.moderatedAt || null,
	createdAt: k.createdAt,
	proposedBy: k.proposedBy
		? { documentId: k.proposedBy.documentId, firstname: k.proposedBy.firstname, lastname: k.proposedBy.lastname }
		: null,
	doctorsCount: k.doctors?.length || 0,
	categories: (k.categories || []).map((c) => ({ id: c.id, name: c.name })),
});

const MODERATION_POPULATE = {
	proposedBy: { fields: ['firstname', 'lastname'] },
	doctors: { fields: ['id'] },
	categories: { fields: ['name'] },
};

// Onglets de la modération
const MODERATION_VIEWS = {
	pending: { status: 'pending' },
	global: { status: 'approved', global: true },
	private: { status: 'approved', global: false },
	rejected: { status: 'rejected' },
};

module.exports = createCoreController(UID, ({ strapi }) => {
	const myDoctor = (user) =>
		strapi.documents(DOCTOR).findFirst({
			filters: { users_permissions_user: { id: user.id } },
			fields: ['id'],
			populate: {
				categories: { fields: ['id'], populate: { families: { fields: ['domain'] } } },
				keywords: { fields: FIELDS },
			},
		});

	const proposalsOf = (doctor, status) =>
		strapi.documents(UID).findMany({
			filters: { proposedBy: { id: doctor.id }, status },
			fields: [...FIELDS, 'moderationNote', 'moderatedAt', 'createdAt'],
			sort: 'createdAt:desc',
			limit: 20,
		});

	const minePayload = async (doctor) => {
		const categoryIds = doctor.categories.map((c) => c.id);
		const [pending, rejected, suggested] = await Promise.all([
			proposalsOf(doctor, 'pending'),
			proposalsOf(doctor, 'rejected'),
			categoryIds.length
				? strapi.documents(UID).findMany({
						filters: { ...PUBLIC_FILTERS, categories: { id: { $in: categoryIds } } },
						fields: FIELDS,
						populate: { categories: { fields: ['id'] } },
						sort: 'name:asc',
						limit: 80,
				  })
				: [],
		]);
		return {
			limit: KEYWORD_LIMIT,
			canUseSensitive: isMedical(doctor),
			keywords: doctor.keywords.map(view),
			pending: pending.map(view),
			// Motif du refus transmis au praticien
			rejected: rejected.map((k) => ({ ...view(k), moderationNote: k.moderationNote || null, moderatedAt: k.moderatedAt })),
			suggested: suggested.filter((k) => canUseKeyword(doctor, k)).map(view),
		};
	};

	return {
		async find(ctx) {
			if (isAdmin(ctx.state.user)) return super.find(ctx);
			const { filters, populate, ...query } = ctx.query || {};
			ctx.query = { ...query, filters: filters ? { $and: [filters, PUBLIC_FILTERS] } : PUBLIC_FILTERS };
			return super.find(ctx);
		},

		async findOne(ctx) {
			if (isAdmin(ctx.state.user)) return super.findOne(ctx);
			const visible = await strapi.documents(UID).findFirst({
				filters: { documentId: ctx.params.id, ...PUBLIC_FILTERS },
				fields: ['id'],
			});
			if (!visible) return ctx.notFound();
			const { populate, ...query } = ctx.query || {};
			ctx.query = query;
			return super.findOne(ctx);
		},

		async create(ctx) {
			if (!isAdmin(ctx.state.user)) return ctx.forbidden();
			return super.create(ctx);
		},

		async update(ctx) {
			if (!isAdmin(ctx.state.user)) return ctx.forbidden();
			return super.update(ctx);
		},

		async delete(ctx) {
			if (!isAdmin(ctx.state.user)) return ctx.forbidden();
			return super.delete(ctx);
		},

		async mine(ctx) {
			const user = ctx.state.user;
			if (!user) return ctx.unauthorized();
			const doctor = await myDoctor(user);
			if (!doctor) return ctx.forbidden('Réservé aux praticiens.');
			ctx.body = await minePayload(doctor);
		},

		/**
		 * Corps : { keywords: [documentId…], proposals: [{ name, type }] }
		 * `keywords` remplace la sélection du praticien ; chaque proposition part en modération,
		 * sauf si elle correspond à un mot-clé déjà disponible (ajouté directement).
		 */
		async setMine(ctx) {
			const user = ctx.state.user;
			if (!user) return ctx.unauthorized();
			const doctor = await myDoctor(user);
			if (!doctor) return ctx.forbidden('Réservé aux praticiens.');

			const body = ctx.request.body || {};
			const ids = new Set((Array.isArray(body.keywords) ? body.keywords : []).map(String));
			const proposals = (Array.isArray(body.proposals) ? body.proposals : [])
				.map((p) => ({ name: String(p?.name || '').replace(/\s+/g, ' ').trim(), type: TYPES.includes(p?.type) ? p.type : 'symptom' }))
				.filter((p) => p.name);
			const tooShortOrLong = proposals.find((p) => p.name.length < NAME_MIN || p.name.length > NAME_MAX);
			if (tooShortOrLong) return ctx.badRequest(`Un mot-clé fait entre ${NAME_MIN} et ${NAME_MAX} caractères.`);

			const ownPending = await proposalsOf(doctor, 'pending');
			const ownRejected = await proposalsOf(doctor, 'rejected');
			const toCreate = [];
			for (const proposal of proposals) {
				const key = normalize(proposal.name);
				if (ownPending.some((k) => normalize(k.name) === key) || toCreate.some((p) => normalize(p.name) === key)) continue;
				if (ownRejected.some((k) => normalize(k.name) === key)) {
					return ctx.badRequest(`« ${proposal.name} » a déjà été refusé par la modération.`);
				}
				// Déjà disponible (liste Meyana ou mot-clé validé de ce praticien) : ajouté directement
				const candidates = await strapi.documents(UID).findMany({
					filters: {
						status: 'approved',
						searchText: { $containsi: key },
						$or: [{ global: true }, { proposedBy: { id: doctor.id } }],
					},
					fields: ['name'],
					limit: 20,
				});
				const match = candidates.find((k) => normalize(k.name) === key);
				if (match) ids.add(match.documentId);
				else toCreate.push(proposal);
			}

			const chosen = ids.size
				? await strapi.documents(UID).findMany({
						filters: { documentId: { $in: [...ids] } },
						fields: FIELDS,
						populate: { categories: { fields: ['id'] }, proposedBy: { fields: ['id'] } },
						limit: -1,
				  })
				: [];
			for (const id of ids) {
				const keyword = chosen.find((k) => k.documentId === id);
				const available =
					keyword?.status === 'approved' && (keyword.global || keyword.proposedBy?.id === doctor.id);
				if (!available) return ctx.badRequest(`Le mot-clé ${keyword ? `« ${keyword.name} » ` : ''}n’est pas disponible.`);
				if (!canUseKeyword(doctor, keyword)) {
					return ctx.badRequest(`« ${keyword.name} » est réservé aux professions médicales concernées.`);
				}
			}
			if (ids.size + ownPending.length + toCreate.length > KEYWORD_LIMIT) {
				return ctx.badRequest(`${KEYWORD_LIMIT} mots-clés au maximum, propositions en attente comprises.`);
			}

			await strapi.documents(DOCTOR).update({ documentId: doctor.documentId, data: { keywords: [...ids] } });
			for (const proposal of toCreate) {
				await strapi.documents(UID).create({
					data: { name: proposal.name, type: proposal.type, status: 'pending', global: false, proposedBy: doctor.id },
				});
			}
			ctx.body = await minePayload(await myDoctor(user));
		},

		/** Liste de modération : ?view=pending|global|private|rejected&q=&page= */
		async moderation(ctx) {
			if (!isAdmin(ctx.state.user)) return ctx.forbidden();
			const { view: tab = 'pending', q = '', page = 1 } = ctx.query || {};
			const term = normalize(q);
			const filters = { ...(MODERATION_VIEWS[tab] || MODERATION_VIEWS.pending), ...(term && { searchText: { $containsi: term } }) };
			const current = Math.max(1, Number(page) || 1);
			const [rows, total, ...counts] = await Promise.all([
				strapi.documents(UID).findMany({
					filters,
					fields: [...FIELDS, 'moderationNote', 'moderatedAt', 'createdAt'],
					populate: MODERATION_POPULATE,
					sort: tab === 'pending' ? 'createdAt:asc' : 'name:asc',
					start: (current - 1) * MODERATION_PAGE_SIZE,
					limit: MODERATION_PAGE_SIZE,
				}),
				strapi.documents(UID).count({ filters }),
				...Object.values(MODERATION_VIEWS).map((f) => strapi.documents(UID).count({ filters: f })),
			]);
			ctx.body = {
				data: rows.map(moderationView),
				meta: { page: current, pageCount: Math.max(1, Math.ceil(total / MODERATION_PAGE_SIZE)), total },
				counts: Object.fromEntries(Object.keys(MODERATION_VIEWS).map((key, i) => [key, counts[i]])),
			};
		},

		/**
		 * Décision ou correction de l'admin : { name, synonyms, type, sensitive, global, status, moderationNote }.
		 * Validé : relié au praticien qui l'a proposé ; refusé : retiré des fiches (src/keywords.js).
		 */
		async moderate(ctx) {
			if (!isAdmin(ctx.state.user)) return ctx.forbidden();
			const input = ctx.request.body?.data || {};
			const data = Object.fromEntries(Object.entries(input).filter(([key]) => EDITABLE.includes(key)));
			if ('name' in data) {
				data.name = String(data.name || '').replace(/\s+/g, ' ').trim();
				if (data.name.length < NAME_MIN || data.name.length > NAME_MAX) {
					return ctx.badRequest(`Un mot-clé fait entre ${NAME_MIN} et ${NAME_MAX} caractères.`);
				}
			}
			if ('type' in data && !TYPES.includes(data.type)) return ctx.badRequest('Type de mot-clé inconnu.');
			if ('status' in data && !Object.values(MODERATION_VIEWS).some((v) => v.status === data.status)) {
				return ctx.badRequest('Statut inconnu.');
			}
			const existing = await strapi.documents(UID).findOne({ documentId: ctx.params.id, fields: ['id'] });
			if (!existing) return ctx.notFound();
			await strapi.documents(UID).update({ documentId: ctx.params.id, data });
			const updated = await strapi.documents(UID).findOne({
				documentId: ctx.params.id,
				fields: [...FIELDS, 'moderationNote', 'moderatedAt', 'createdAt'],
				populate: MODERATION_POPULATE,
			});
			ctx.body = { data: moderationView(updated) };
		},

		/** Retrait d'une proposition encore en attente */
		async withdraw(ctx) {
			const user = ctx.state.user;
			if (!user) return ctx.unauthorized();
			const doctor = await myDoctor(user);
			if (!doctor) return ctx.forbidden('Réservé aux praticiens.');
			const proposal = await strapi.documents(UID).findFirst({
				filters: { documentId: ctx.params.id, status: 'pending', proposedBy: { id: doctor.id } },
				fields: ['id'],
			});
			if (!proposal) return ctx.notFound();
			await strapi.documents(UID).delete({ documentId: proposal.documentId });
			ctx.body = await minePayload(doctor);
		},
	};
});
