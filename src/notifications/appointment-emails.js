'use strict';

/**
 * Emails détaillés des rendez-vous :
 * - confirmation au patient ;
 * - nouveau rendez-vous au praticien.
 * Chacun joint un fichier calendrier (.ics). Aucune donnée de santé (ni motif détaillé,
 * ni note) : elles restent sur la page du rendez-vous, accessible après connexion.
 */

const { renderEmail, frontUrl } = require('./email');
const { TIME_ZONE, fullName } = require('./helpers');

const DEFAULT_DURATION = 30;

const dateLong = (iso) =>
	new Date(iso).toLocaleDateString('fr-FR', {
		weekday: 'long',
		day: 'numeric',
		month: 'long',
		year: 'numeric',
		timeZone: TIME_ZONE,
	});

const timeOf = (iso) =>
	new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: TIME_ZONE });

const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** « 45 min », « 1 h », « 1 h 30 » */
const durationLabel = (minutes) => {
	const m = Number(minutes) || DEFAULT_DURATION;
	if (m < 60) return `${m} min`;
	const h = Math.floor(m / 60);
	const rest = m % 60;
	return rest ? `${h} h ${String(rest).padStart(2, '0')}` : `${h} h`;
};

/** Métier affiché, au féminin si le profil l'indique (« Naturopathe », « Diététicienne ») */
const professionOf = (a) => {
	const c = a.category;
	if (!c) return '';
	return (a.doctor?.gender === 'woman' && c.professionNameFeminine) || c.professionName || c.name || '';
};

const addressOf = (a) => {
	const ad = a.appointmentAddress || {};
	return [ad.line, [ad.postcode, ad.city].filter(Boolean).join(' ')].filter(Boolean).join('\n');
};

const priceOf = (a) => {
	const { minimum, maximum } = a.doctor?.priceRange || {};
	if (minimum && maximum && Number(minimum) !== Number(maximum)) return `Entre ${minimum} € et ${maximum} €`;
	if (minimum || maximum) return `${minimum || maximum} €`;
	return null;
};

/** Personne consultée quand le rendez-vous est pris pour un proche */
const relativeOf = (a) => {
	const s = a.someoneElse;
	if (!s?.firstname) return null;
	const name = [s.firstname, s.lastname].filter(Boolean).join(' ');
	return s.age ? `${name}, ${s.age} ans` : name;
};

/* ---------- Fichier calendrier (.ics) ---------- */

const icsDate = (date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsText = (value) =>
	String(value ?? '')
		.replace(/\\/g, '\\\\')
		.replace(/\n/g, '\\n')
		.replace(/[,;]/g, (c) => `\\${c}`);

const calendarAttachment = (a, { summary, description }) => {
	const start = new Date(a.datetime);
	const end = new Date(start.getTime() + (Number(a.duration) || DEFAULT_DURATION) * 60000);
	const url = `${frontUrl()}/appointment/${a.UUID}`;
	const lines = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//Meyana//Rendez-vous//FR',
		'CALSCALE:GREGORIAN',
		'METHOD:PUBLISH',
		'BEGIN:VEVENT',
		`UID:${a.documentId}@meyana.fr`,
		`DTSTAMP:${icsDate(new Date())}`,
		`DTSTART:${icsDate(start)}`,
		`DTEND:${icsDate(end)}`,
		`SUMMARY:${icsText(summary)}`,
		`LOCATION:${icsText(a.isOnline ? 'Visioconférence (lien sur la page du rendez-vous)' : addressOf(a).replace(/\n/g, ', '))}`,
		`DESCRIPTION:${icsText(`${description}\n${url}`)}`,
		`URL:${url}`,
		'BEGIN:VALARM',
		'TRIGGER:-PT1H',
		'ACTION:DISPLAY',
		`DESCRIPTION:${icsText(summary)}`,
		'END:VALARM',
		'END:VEVENT',
		'END:VCALENDAR',
	];
	return {
		filename: 'rendez-vous-meyana.ics',
		content: Buffer.from(lines.join('\r\n')).toString('base64'),
		contentType: 'text/calendar; charset=utf-8',
	};
};

/* ---------- Emails ---------- */

/** Confirmation envoyée au patient qui a réservé. */
const patientBookedEmail = (a) => {
	const doctor = fullName(a.doctor) || 'votre praticien';
	const profession = professionOf(a);
	const when = `${dateLong(a.datetime)} à ${timeOf(a.datetime)}`;
	const relative = relativeOf(a);

	const { html, text } = renderEmail({
		title: 'Votre rendez-vous est confirmé',
		paragraphs: [
			a.patient?.firstname ? `Bonjour ${a.patient.firstname},` : 'Bonjour,',
			`Votre rendez-vous avec ${doctor}${profession ? `, ${profession.toLowerCase()}` : ''}, est bien enregistré${
				relative ? ` pour ${relative.split(',')[0]}` : ''
			}.`,
		],
		details: [
			['Date', capitalize(dateLong(a.datetime))],
			['Heure', `${timeOf(a.datetime)} · ${durationLabel(a.duration)}`],
			['Praticien', [doctor, profession].filter(Boolean).join('\n')],
			['Consultation', a.isOnline ? 'En visio' : 'Au cabinet'],
			['Adresse', a.isOnline ? null : addressOf(a)],
			['Pour', relative],
			['Tarif indicatif', priceOf(a)],
		],
		link: `/appointment/${a.UUID}`,
		cta: 'Voir mon rendez-vous',
		notes: [
			a.isOnline
				? 'Le lien de la visio apparaîtra sur la page du rendez-vous : vous recevrez un email dès que votre praticien l’aura ajouté.'
				: 'Présentez-vous quelques minutes avant l’heure du rendez-vous.',
			'Vous pouvez déposer vos documents utiles (ordonnances, analyses, comptes rendus) sur la page du rendez-vous.',
			'Un empêchement ? Annulez depuis votre espace pour libérer le créneau pour un autre patient.',
			'Ajoutez ce rendez-vous à votre agenda avec le fichier joint.',
		],
	});

	return {
		subject: `Rendez-vous confirmé · ${when}`,
		html,
		text,
		attachments: [
			calendarAttachment(a, {
				summary: `Rendez-vous avec ${doctor}`,
				description: [profession, a.isOnline ? 'En visio' : 'Au cabinet'].filter(Boolean).join(' · '),
			}),
		],
	};
};

/** Nouveau rendez-vous, envoyé au praticien. */
const doctorBookedEmail = (a) => {
	const patient = fullName(a.patient) || 'Un patient';
	const relative = relativeOf(a);
	const when = `${dateLong(a.datetime)} à ${timeOf(a.datetime)}`;

	const { html, text } = renderEmail({
		title: 'Nouveau rendez-vous',
		paragraphs: [
			a.doctor?.firstname ? `Bonjour ${a.doctor.firstname},` : 'Bonjour,',
			relative
				? `${patient} vient de réserver un rendez-vous avec vous pour un proche.`
				: `${patient} vient de réserver un rendez-vous avec vous.`,
		],
		details: [
			['Date', capitalize(dateLong(a.datetime))],
			['Heure', `${timeOf(a.datetime)} · ${durationLabel(a.duration)}`],
			['Patient', relative || patient],
			['Réservé par', relative ? patient : null],
			['Consultation', a.isOnline ? 'En visio' : 'Au cabinet'],
			['Adresse', a.isOnline ? null : addressOf(a)],
		],
		link: `/appointment/${a.UUID}`,
		cta: 'Voir le rendez-vous',
		notes: [
			'Le motif, la note du patient, son carnet de santé et ses documents sont sur la page du rendez-vous.',
			a.isOnline
				? 'Ajoutez le lien de la visio sur la page du rendez-vous : le patient est prévenu automatiquement.'
				: null,
			'Un empêchement ? Annulez le rendez-vous depuis sa page : le patient est prévenu par email.',
		].filter(Boolean),
	});

	return {
		subject: `Nouveau rendez-vous · ${when}`,
		html,
		text,
		attachments: [
			calendarAttachment(a, {
				summary: `Rendez-vous Meyana · ${relative ? relative.split(',')[0] : patient}`,
				description: a.isOnline ? 'Consultation en visio' : 'Consultation au cabinet',
			}),
		],
	};
};

module.exports = { patientBookedEmail, doctorBookedEmail };
