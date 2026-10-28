'use strict';

/**
 * Mesure d'audience Meyana, sans cookie ni traceur (exemptée de consentement, recommandations CNIL) :
 * - aucune adresse IP conservée : le visiteur est un condensat (IP + navigateur + jour + secret),
 *   qui change chaque jour, ce qui empêche de suivre une personne d'un jour à l'autre ;
 * - pas de suivi entre sites, données conservées 13 mois (purge quotidienne, config/cron-tasks.js) ;
 * - le visiteur peut s'y opposer (page Confidentialité) : le site n'envoie alors plus rien.
 */

const crypto = require('crypto');

const { parisKey, bucketOf, rangeFor, split, series } = require('./stats-range');
const { departmentOf } = require('./geo-fr');

const UID = 'api::page-view.page-view';
const DOCTOR = 'api::doctor.doctor';
const ADMIN_ROLE = 'SuperAdmin';
const RETENTION_MONTHS = 13;
// Une même page rechargée par le même visiteur ne compte qu'une fois par demi-heure
const DEDUPE_MS = 30 * 60 * 1000;

/* ---------- Classement d'une visite ---------- */

const BOT = /bot|crawl|spider|slurp|preview|headless|lighthouse|pingdom|uptime|monitor|curl|wget|python|axios|node-fetch|go-http|java\/|facebookexternalhit|^whatsapp/i;

const SEARCH_ENGINES = [
	[/(^|\.)google\./, 'Google'],
	[/(^|\.)bing\.com$/, 'Bing'],
	[/(^|\.)qwant\.com$/, 'Qwant'],
	[/(^|\.)duckduckgo\.com$/, 'DuckDuckGo'],
	[/(^|\.)ecosia\.org$/, 'Ecosia'],
	[/(^|\.)yahoo\./, 'Yahoo'],
	[/^search\.brave\.com$/, 'Brave Search'],
	[/(^|\.)startpage\.com$/, 'Startpage'],
	[/(^|\.)yandex\./, 'Yandex'],
	[/(^|\.)lilo\.org$/, 'Lilo'],
];

const SOCIAL = [
	[/(^|\.)(facebook\.com|fb\.me)$/, 'Facebook'],
	[/(^|\.)instagram\.com$/, 'Instagram'],
	[/(^|\.)(linkedin\.com|lnkd\.in)$/, 'LinkedIn'],
	[/(^|\.)(twitter\.com|x\.com|t\.co)$/, 'X (Twitter)'],
	[/(^|\.)pinterest\./, 'Pinterest'],
	[/(^|\.)(youtube\.com|youtu\.be)$/, 'YouTube'],
	[/(^|\.)tiktok\.com$/, 'TikTok'],
	[/(^|\.)(whatsapp\.com|wa\.me)$/, 'WhatsApp'],
	[/(^|\.)snapchat\.com$/, 'Snapchat'],
	[/(^|\.)reddit\.com$/, 'Reddit'],
	[/(^|\.)threads\.net$/, 'Threads'],
];

const SITE_HOST = /(^|\.)meyana\.fr$|^localhost$|^127\.0\.0\.1$/;

const match = (list, host) => list.find(([re]) => re.test(host))?.[1];

/** Page Meyana d'où vient le visiteur */
const internalName = (path) => {
	if (path === '/') return 'Accueil Meyana';
	if (path === '/doctor' || path.startsWith('/doctor?')) return 'Recherche Meyana';
	if (path.startsWith('/doctor/')) return 'Autre fiche praticien';
	if (path.startsWith('/blog')) return 'Blog Meyana';
	return 'Autre page Meyana';
};

/** { source, sourceName } d'après la page précédente (referrer) */
const classifySource = (referrer, siteHost) => {
	let url;
	try {
		url = new URL(referrer);
	} catch {
		return { source: 'direct', sourceName: null };
	}
	const host = url.hostname.toLowerCase().replace(/^www\./, '');
	if (SITE_HOST.test(host) || host === siteHost) return { source: 'internal', sourceName: internalName(url.pathname) };
	const engine = match(SEARCH_ENGINES, host);
	if (engine) return { source: 'search', sourceName: engine };
	const social = match(SOCIAL, host);
	if (social) return { source: 'social', sourceName: social };
	// Applications Android (android-app://com.google.android.gm…) : pas de nom de site exploitable
	return { source: 'referral', sourceName: url.protocol.startsWith('http') ? host : 'Application' };
};

const deviceOf = (ua) => {
	if (/iPad|Tablet|PlayBook|Silk/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return 'tablet';
	if (/Mobi|iPhone|iPod|Android/i.test(ua)) return 'mobile';
	return 'desktop';
};

const pageTypeOf = (path) => {
	if (path === '/') return 'home';
	if (path === '/doctor') return 'search';
	if (path.startsWith('/doctor/')) return 'doctor';
	if (path === '/blog') return 'blog';
	if (path.startsWith('/blog/')) return 'article';
	return 'other';
};

/** Compte connecté (facultatif) : { visitor, isAdmin, doctorDocumentId } */
const visitorOf = async (strapi, ctx) => {
	let payload = null;
	try {
		payload = await strapi.plugin('users-permissions').service('jwt').getToken(ctx);
	} catch {
		// Jeton expiré ou invalide : visite comptée comme non connectée
	}
	if (!payload?.id) return { visitor: 'anonymous' };
	const user = await strapi.db.query('plugin::users-permissions.user').findOne({
		where: { id: payload.id },
		select: ['id', 'isDoctor'],
		populate: { role: { select: ['name'] }, doctor: { select: ['documentId'] } },
	});
	if (!user) return { visitor: 'anonymous' };
	return {
		visitor: user.doctor || user.isDoctor ? 'practitioner' : 'patient',
		isAdmin: user.role?.name === ADMIN_ROLE,
		doctorDocumentId: user.doctor?.documentId,
	};
};

/** Enregistre une page vue. Ne lève jamais d'erreur vers le visiteur. */
const track = async (strapi, ctx) => {
	const body = ctx.request.body || {};
	const ua = String(ctx.get('user-agent') || '').slice(0, 400);
	if (!ua || BOT.test(ua)) return;

	const rawPath = typeof body.path === 'string' ? body.path : '';
	// Chemin seul : pas de paramètres d'URL (recherches saisies, jetons…)
	const path = rawPath.split(/[?#]/)[0].slice(0, 255);
	if (!path.startsWith('/')) return;

	const who = await visitorOf(strapi, ctx);
	if (who.isAdmin) return; // l'équipe Meyana ne fausse pas les chiffres

	let pageType = body.notFound ? 'not_found' : pageTypeOf(path);
	let doctorDocumentId = null;
	if (pageType === 'doctor') {
		const slug = decodeURIComponent(path.split('/')[2] || '');
		const doctor = slug
			? await strapi.db.query(DOCTOR).findOne({ where: { UUID: slug }, select: ['documentId'] })
			: null;
		if (!doctor) pageType = 'not_found';
		// Le praticien qui consulte sa propre fiche n'est pas compté
		else if (doctor.documentId === who.doctorDocumentId) return;
		else doctorDocumentId = doctor.documentId;
	}

	let siteHost = '';
	try {
		siteHost = new URL(ctx.get('origin')).hostname.replace(/^www\./, '');
	} catch {
		// Pas d'en-tête Origin : seuls les domaines Meyana comptent comme internes
	}
	const { source, sourceName } = classifySource(typeof body.referrer === 'string' ? body.referrer : '', siteHost);

	const ip = String(ctx.get('x-forwarded-for') || '').split(',')[0].trim() || ctx.ip || '';
	const secret = strapi.config.get('server.app.keys', [])[0] || 'meyana';
	const visitorHash = crypto
		.createHash('sha256')
		.update(`${secret}|${parisKey(new Date())}|${ip}|${ua}`)
		.digest('hex')
		.slice(0, 24);

	const recent = await strapi.db.query(UID).findOne({
		where: { visitorHash, path, createdAt: { $gte: new Date(Date.now() - DEDUPE_MS) } },
		select: ['id'],
	});
	if (recent) return;

	await strapi.db.query(UID).create({
		data: { path, pageType, doctorDocumentId, source, sourceName, visitor: who.visitor, device: deviceOf(ua), visitorHash },
	});
};

/** Purge des visites de plus de 13 mois */
const purge = async (strapi) => {
	const limit = new Date();
	limit.setMonth(limit.getMonth() - RETENTION_MONTHS);
	const { count } = await strapi.db.query(UID).deleteMany({ where: { createdAt: { $lt: limit } } });
	if (count) strapi.log.info(`Audience : ${count} visites de plus de ${RETENTION_MONTHS} mois supprimées`);
};

/* ---------- Statistiques ---------- */

const FIELDS = ['id', 'createdAt', 'path', 'pageType', 'doctorDocumentId', 'source', 'sourceName', 'visitor', 'device', 'visitorHash'];

const loadViews = async (strapi, range, where = {}) => {
	const rows = await strapi.db.query(UID).findMany({
		select: FIELDS,
		where: { createdAt: { $gte: range.from }, ...where },
	});
	return rows.map((row) => ({ ...row, day: parisKey(row.createdAt) }));
};

/** Visiteurs distincts, comptés jour par jour (le condensat change chaque jour) */
const uniqueVisitors = (rows) => new Set(rows.map((r) => `${r.day}|${r.visitorHash}`)).size;

/** Visites et visiteurs dans le temps (tranches de la période) */
const traffic = (rows, range) => {
	const views = series(rows, range);
	const { current, previous } = split(rows, range);
	const perBucket = Object.fromEntries(range.buckets.map((k) => [k, new Set()]));
	for (const r of current) perBucket[bucketOf(r.day, range.unit)]?.add(`${r.day}|${r.visitorHash}`);
	return {
		...views,
		visitors: uniqueVisitors(current),
		visitorsPrevious: uniqueVisitors(previous),
		buckets: views.buckets.map((b) => ({ ...b, visitors: perBucket[b.key]?.size || 0 })),
	};
};

/** [{ name, count }] trié, les plus petits regroupés au-delà de `limit` */
const countBy = (rows, keyOf, limit = 6, others = 'Autres') => {
	const counts = {};
	for (const r of rows) {
		const key = keyOf(r);
		if (key) counts[key] = (counts[key] || 0) + 1;
	}
	const sorted = Object.entries(counts)
		.map(([name, count]) => ({ name, count }))
		.sort((a, b) => b.count - a.count);
	if (!limit || sorted.length <= limit) return sorted;
	return [...sorted.slice(0, limit - 1), { name: others, count: sorted.slice(limit - 1).reduce((s, x) => s + x.count, 0) }];
};

const CHANNEL_LABELS = {
	search: 'Moteurs de recherche',
	internal: 'Navigation sur Meyana',
	direct: 'Accès direct',
	social: 'Réseaux sociaux',
	referral: 'Autres sites',
};
const VISITOR_LABELS = { anonymous: 'Non connectés', patient: 'Patients connectés', practitioner: 'Praticiens connectés' };
const DEVICE_LABELS = { mobile: 'Mobile', desktop: 'Ordinateur', tablet: 'Tablette' };

const sourceLabel = (r) => (r.source === 'direct' ? 'Accès direct' : r.sourceName || CHANNEL_LABELS[r.source]);

/** Provenance et profil des visiteurs d'un ensemble de visites */
const audienceOf = (rows) => ({
	channels: countBy(rows, (r) => CHANNEL_LABELS[r.source], 0),
	sources: countBy(rows, sourceLabel, 8, 'Autres provenances'),
	visitors: countBy(rows, (r) => VISITOR_LABELS[r.visitor], 0),
	devices: countBy(rows, (r) => DEVICE_LABELS[r.device], 0),
	fromSearch: rows.filter((r) => r.source === 'search').length,
});

const periodInfo = (range) => ({ value: range.period, unit: range.unit, start: range.start, end: range.end, prevStart: range.prevStart });

/** Audience de la fiche d'un praticien */
const doctorAudience = async (strapi, doctorDocumentId, periodKey) => {
	const range = rangeFor(periodKey);
	const rows = await loadViews(strapi, range, { doctorDocumentId, pageType: 'doctor' });
	const { current } = split(rows, range);
	return { period: periodInfo(range), traffic: traffic(rows, range), ...audienceOf(current) };
};

const fullName = (d) => [d.firstname, d.lastname].filter(Boolean).join(' ');

const PAGE_LABELS = {
	'/': 'Accueil',
	'/doctor': 'Recherche de praticiens',
	'/blog': 'Blog',
	'/a-propos': 'À propos',
	'/engagements': 'Nos engagements',
	'/contact': 'Contact',
	'/inscription': 'Inscription',
	'/login': 'Connexion',
	'/cgu': 'CGU',
	'/confidentialite': 'Confidentialité',
	'/mentions-legales': 'Mentions légales',
};

/** Audience de tout le site (SuperAdmin) */
const siteAudience = async (strapi, periodKey) => {
	const range = rangeFor(periodKey);
	const all = await loadViews(strapi, range);
	const pages = all.filter((r) => r.pageType !== 'not_found');
	const notFound = all.filter((r) => r.pageType === 'not_found');
	const { current } = split(pages, range);
	const notFoundSplit = split(notFound, range);

	// Pages les plus lues, fiches praticiens et articles nommés
	const top = countBy(current, (r) => r.path, 0).slice(0, 15);
	const doctorIds = [...new Set(current.filter((r) => r.doctorDocumentId).map((r) => r.doctorDocumentId))];
	const slugs = top.filter((p) => p.name.startsWith('/blog/')).map((p) => p.name.slice(6));
	const [doctors, articles] = await Promise.all([
		doctorIds.length
			? strapi.db.query(DOCTOR).findMany({ where: { documentId: { $in: doctorIds } }, select: ['documentId', 'UUID', 'firstname', 'lastname'] })
			: [],
		slugs.length
			? strapi.db.query('api::article.article').findMany({ where: { slug: { $in: slugs } }, select: ['slug', 'title'] })
			: [],
	]);
	const doctorByUuid = Object.fromEntries(doctors.map((d) => [d.UUID, d]));
	const articleBySlug = Object.fromEntries(articles.map((a) => [a.slug, a.title]));
	const pageLabel = (path) => {
		if (PAGE_LABELS[path]) return PAGE_LABELS[path];
		if (path.startsWith('/doctor/')) {
			const d = doctorByUuid[path.slice(8)];
			return d ? `Fiche · ${fullName(d)}` : 'Fiche praticien';
		}
		if (path.startsWith('/blog/')) return articleBySlug[path.slice(6)] ? `Article · ${articleBySlug[path.slice(6)]}` : 'Article';
		return null;
	};

	return {
		period: periodInfo(range),
		traffic: traffic(pages, range),
		notFound: {
			...series(notFound, range),
			paths: countBy(notFoundSplit.current, (r) => r.path, 0).slice(0, 15),
		},
		topPages: top.map((p) => ({ path: p.name, label: pageLabel(p.name), count: p.count })),
		sections: countBy(
			current,
			(r) =>
				({ home: 'Accueil', search: 'Recherche', doctor: 'Fiches praticiens', article: 'Articles', blog: 'Blog' })[r.pageType] ||
				'Autres pages',
			0
		),
		...audienceOf(current),
	};
};

/** Pays d'une adresse saisie librement (« france », « FR »…) */
const countryName = (value, department) => {
	const v = String(value || '').trim();
	if (!v) return department ? 'France' : null;
	if (/^(fr|fra|france)$/i.test(v)) return 'France';
	return v.charAt(0).toUpperCase() + v.slice(1);
};

/** Classement des praticiens en ligne par audience de leur fiche (SuperAdmin) */
const doctorsRanking = async (strapi, periodKey) => {
	const range = rangeFor(periodKey);
	const [rows, doctors] = await Promise.all([
		loadViews(strapi, range, { pageType: 'doctor' }),
		strapi.db.query(DOCTOR).findMany({
			where: { isActive: true },
			select: ['documentId', 'UUID', 'firstname', 'lastname', 'gender', 'isRecommended'],
			populate: {
				categories: { select: ['name', 'slug'] },
				AddressDoctor: true,
				AddressGlobal: true,
			},
		}),
	]);
	const { current, previous } = split(rows, range);

	const stats = {};
	const statOf = (id) => (stats[id] ||= { views: 0, previous: 0, visitors: new Set(), fromSearch: 0 });
	for (const r of current) {
		const s = statOf(r.doctorDocumentId);
		s.views += 1;
		s.visitors.add(`${r.day}|${r.visitorHash}`);
		if (r.source === 'search') s.fromSearch += 1;
	}
	for (const r of previous) statOf(r.doctorDocumentId).previous += 1;

	const list = doctors.map((d) => {
		// Premier lieu de consultation renseigné, sinon l'adresse principale
		const address = (d.AddressDoctor || []).find((a) => a?.postcode) || d.AddressGlobal || {};
		const department = departmentOf(address.postcode);
		const country = countryName(address.country, department);
		const s = stats[d.documentId] || { views: 0, previous: 0, visitors: new Set(), fromSearch: 0 };
		return {
			documentId: d.documentId,
			uuid: d.UUID,
			name: fullName(d) || 'Sans nom',
			isRecommended: Boolean(d.isRecommended),
			categories: (d.categories || []).map((c) => ({ name: c.name, slug: c.slug })),
			city: address.city || null,
			department: department && country === 'France' ? { code: department.code, name: department.name } : null,
			region: country === 'France' ? department?.region || null : null,
			country,
			views: s.views,
			previous: s.previous,
			visitors: s.visitors.size,
			fromSearch: s.fromSearch,
		};
	});
	list.sort((a, b) => b.views - a.views || b.visitors - a.visitors || a.name.localeCompare(b.name, 'fr'));

	return { period: periodInfo(range), total: current.length, doctors: list };
};

module.exports = { track, purge, doctorAudience, siteAudience, doctorsRanking, ADMIN_ROLE };
