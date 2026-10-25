'use strict';

/**
 * Charte éthique (single type « Charte éthique »).
 *
 * - Au premier démarrage, la charte est créée avec le texte fourni par Meyana (v1.0),
 *   ensuite elle se modifie uniquement dans le panneau d'administration.
 * - Lecture publique : le site l'affiche aux praticiens avant signature.
 * - La version en vigueur est celle enregistrée sur chaque signature
 *   (contrôleur doctor). Changer la version = nouvelle signature demandée.
 */

const UID = 'api::charter.charter';
const PUBLIC_ACTION = 'api::charter.charter.find';
const FALLBACK_VERSION = '1.0';

const INITIAL_CHARTER = {
	"title": "Charte éthique et déontologique des praticiens",
	"version": "1.0",
	"dateLabel": "octobre 2026",
	"sections": [
		{
			"title": "Préambule — La confiance au cœur de Meyana",
			"content": "Meyana a été créée avec une conviction fondamentale : chacun doit pouvoir rechercher un accompagnement de qualité dans un environnement fondé sur la confiance, le respect, la transparence et la responsabilité.\n\nNotre ambition est de proposer une plateforme qui ne se contente pas de répertorier des praticiens, mais qui s’engage dans une démarche de sélection et de vérification, afin d’offrir aux utilisateurs un cadre plus rassurant pour leurs recherches.\n\nLa présence d’un praticien sur Meyana implique son adhésion à des principes éthiques communs. Chaque professionnel référencé s’engage à exercer dans les limites de ses compétences, à présenter ses prestations avec honnêteté, à respecter la dignité des personnes et à ne jamais exploiter leur vulnérabilité.\n\nLa confiance ne se décrète pas : elle se mérite, se vérifie et se protège.\n\nLa présente charte constitue un engagement obligatoire pour tout praticien souhaitant être référencé sur Meyana."
		},
		{
			"title": "Article 1 — Compétence, qualifications et transparence",
			"content": "Tout praticien référencé sur Meyana s’engage à :\n\n• Fournir des informations exactes, complètes et vérifiables concernant son identité, sa formation, ses qualifications, ses diplômes, ses certifications et son expérience.\n• Ne jamais revendiquer un titre, un diplôme, une spécialité ou une compétence qu’il ne possède pas.\n• Exercer exclusivement dans les limites de ses compétences et des autorisations requises par la réglementation applicable.\n• Présenter clairement la nature de ses prestations, leurs objectifs, leurs limites et, le cas échéant, leur statut réglementaire.\n• Accepter les vérifications documentaires raisonnablement nécessaires à son référencement.\n• Informer Meyana de tout changement significatif concernant ses qualifications, son activité ou son droit d’exercer.\n\nLa vérification effectuée par Meyana porte sur les éléments effectivement contrôlés. Elle ne saurait être présentée comme une garantie absolue de la qualité de chaque prestation ni comme une certification de résultats."
		},
		{
			"title": "Article 2 — Intégrité des pratiques et exclusions de référencement",
			"content": "Meyana sélectionne les praticiens selon des critères exigeants de compétence, de transparence, de responsabilité et de respect des personnes.\n\nAfin de préserver la confiance des utilisateurs et la cohérence de son positionnement, la plateforme ne référence pas les prestations reposant notamment sur :\n\n• Les pratiques occultes, la divination, la voyance et la médiumnité.\n• Les rituels ou procédés prétendant révéler des informations cachées, prédire l’avenir ou agir sur une personne par des moyens surnaturels.\n• Les pratiques énergétiques ou ésotériques, notamment le Reiki et les approches fondées sur les chakras, lorsqu’elles sont proposées comme des méthodes de diagnostic, de traitement ou de guérison.\n• Les méthodes présentées comme thérapeutiques sans fondement suffisamment établi, notamment lorsqu’elles comportent des promesses de guérison, des affirmations trompeuses ou un risque pour la santé.\n• Toute prestation impliquant une emprise psychologique, une pression financière, une exploitation de la vulnérabilité ou une incitation à interrompre un traitement médical.\n\nCette politique de référencement porte sur la nature des prestations proposées et sur leur conformité aux exigences de Meyana. Elle ne constitue pas un jugement sur les convictions personnelles des praticiens ou des utilisateurs.\n\nTout accompagnement doit être présenté avec transparence quant à sa nature, ses objectifs, ses limites et les qualifications de la personne qui le propose. Aucune prestation ne peut se substituer à un suivi médical lorsqu’il est nécessaire, ni garantir un résultat qui ne peut être raisonnablement établi.\n\nMeyana se réserve le droit de refuser ou de retirer le référencement d’une prestation qui ne respecte pas les exigences de la présente charte."
		},
		{
			"title": "Article 3 — Respect de la dignité, de la pudeur et des convictions",
			"content": "Chaque praticien s’engage à accueillir toute personne avec dignité, bienveillance, discrétion et respect, sans jugement humiliant ni comportement abusif.\n\nIl s’engage notamment à :\n\n• Respecter l’intégrité physique, psychologique et morale des personnes accompagnées.\n• Respecter leur intimité, leur pudeur, leurs convictions personnelles et leurs limites.\n• Prendre en considération, dans la mesure du possible et selon les contraintes de son activité, les préférences exprimées concernant le genre du praticien, la langue ou les modalités de consultation.\n• Ne jamais imposer ses convictions personnelles, ses opinions ou son mode de vie à une personne accompagnée.\n• Ne pratiquer aucune discrimination illicite fondée notamment sur l’origine, le sexe, la religion, le handicap ou toute autre caractéristique protégée par la loi.\n• Respecter le droit de chaque personne de poser des questions, de refuser une prestation ou d’y mettre fin.\n\nToute relation d’accompagnement doit demeurer fondée sur le consentement libre et éclairé de la personne."
		},
		{
			"title": "Article 4 — Absence de manipulation et protection des personnes vulnérables",
			"content": "Meyana considère que la confiance accordée à un praticien implique une responsabilité particulière.\n\nTout praticien s’interdit :\n\n• De promettre une guérison certaine, un résultat garanti ou un changement miraculeux.\n• D’exploiter la peur, la détresse, la solitude, le désespoir ou la vulnérabilité d’une personne.\n• D’exercer des pressions psychologiques, affectives, financières ou idéologiques.\n• De créer ou d’entretenir volontairement une dépendance à son accompagnement.\n• De culpabiliser une personne qui souhaite interrompre les séances ou demander un autre avis.\n• De tirer profit de la relation d’accompagnement pour obtenir des avantages personnels, financiers, affectifs ou sexuels.\n• De formuler des affirmations trompeuses sur ses compétences, ses méthodes ou les résultats obtenus par ses clients.\n\nLes prestations et leur fréquence doivent être adaptées aux besoins réels de la personne, sans incitation abusive à multiplier les séances.\n\nUne relation de confiance ne doit jamais devenir un moyen d’emprise."
		},
		{
			"title": "Article 5 — Responsabilité professionnelle et limites de compétence",
			"content": "Chaque praticien est responsable des prestations qu’il propose et des actes qu’il réalise.\n\nIl s’engage à :\n\n• Respecter les lois, les réglementations et les obligations professionnelles applicables à son activité.\n• Ne pas réaliser d’actes réservés à une profession réglementée s’il n’y est pas légalement autorisé.\n• Ne pas établir de diagnostic médical, prescrire un traitement ou revendiquer une compétence médicale sans disposer des qualifications et autorisations nécessaires.\n• Ne jamais conseiller à une personne d’interrompre, de modifier ou de remplacer un traitement médical prescrit.\n• Reconnaître les limites de ses compétences et orienter la personne vers un professionnel adapté lorsque la situation l’exige.\n• Adopter une attitude responsable face aux situations de détresse psychologique, de danger ou d’urgence.\n\nMeyana ne remplace ni un professionnel de santé, ni un service d’urgence, ni les organismes compétents en matière de soins.\n\nLe praticien doit toujours privilégier la sécurité et l’intérêt de la personne accompagnée."
		},
		{
			"title": "Article 6 — Transparence des prestations et des tarifs",
			"content": "La confiance suppose une information claire avant toute prise de rendez-vous.\n\nChaque praticien s’engage à :\n\n• Afficher des informations exactes sur ses prestations, ses tarifs, ses modalités de consultation et ses conditions d’annulation.\n• Informer la personne à l’avance de tout coût supplémentaire éventuel.\n• Ne pas dissimuler de frais, de conditions importantes ou de liens commerciaux susceptibles d’influencer son accompagnement.\n• Ne pas utiliser de témoignages fictifs, de faux avis, de fausses qualifications ou de déclarations trompeuses.\n• Présenter ses méthodes et leurs limites sans exagération ni promesse infondée.\n• Signaler clairement, lorsque cela est pertinent, le caractère non réglementé d’une activité ou l’absence de qualification officiellement reconnue.\n\nToute évolution importante des informations présentées sur le profil doit être signalée et, lorsque nécessaire, soumise à une nouvelle vérification."
		},
		{
			"title": "Article 7 — Confidentialité et protection des données",
			"content": "Le respect de la vie privée constitue une exigence fondamentale de Meyana.\n\nChaque praticien s’engage à :\n\n• Préserver la confidentialité des informations reçues dans le cadre de son activité.\n• Ne collecter que les informations nécessaires à la prestation proposée.\n• Ne pas divulguer, transmettre ou utiliser les informations personnelles d’un utilisateur à des fins étrangères à la prestation, sauf base légale valable.\n• Respecter les obligations applicables en matière de secret professionnel, de confidentialité et de protection des données personnelles.\n• Sécuriser les informations et documents auxquels il a accès.\n• Ne pas utiliser les coordonnées d’un utilisateur pour du démarchage non sollicité ou à des fins personnelles.\n• Ne pas partager d’informations, de photographies, de témoignages ou de situations personnelles sans autorisation valable et dans le respect de la réglementation applicable.\n\nLes données de santé et les autres informations sensibles doivent bénéficier d’une vigilance renforcée.\n\nLe praticien demeure responsable du respect de ses propres obligations légales et professionnelles en matière de confidentialité."
		},
		{
			"title": "Article 8 — Professionnalisme et respect des engagements",
			"content": "Tout praticien référencé s’engage à adopter une conduite professionnelle et respectueuse.\n\nIl doit notamment :\n\n• Honorer les rendez-vous confirmés ou prévenir l’utilisateur dans un délai raisonnable en cas d’empêchement.\n• Respecter les horaires, les modalités de consultation et les conditions annoncées.\n• Maintenir son profil à jour et informer Meyana de tout changement important.\n• Communiquer avec courtoisie et dans des délais raisonnables.\n• Ne pas utiliser la plateforme pour diffuser des contenus trompeurs, illicites, abusifs ou sans rapport avec son activité.\n• Ne pas contourner les règles de Meyana dans le but de tromper les utilisateurs ou de compromettre la confiance dans la plateforme.\n• Coopérer de bonne foi avec Meyana lorsqu’une vérification ou une réclamation justifie un examen de sa pratique.\n\nLe professionnalisme se manifeste autant dans la qualité de l’accompagnement que dans le respect des engagements pris."
		},
		{
			"title": "Article 9 — Avis, recommandations et badges de confiance",
			"content": "Les avis, recommandations et badges affichés sur Meyana ont pour objectif d’aider les utilisateurs à mieux comprendre le profil d’un praticien.\n\nTout praticien s’engage à :\n\n• Ne pas publier de faux avis ni solliciter la création de témoignages mensongers.\n• Ne pas acheter, manipuler ou tenter de falsifier des évaluations.\n• Ne pas exercer de pression sur un utilisateur pour obtenir une note positive ou empêcher la publication d’un avis sincère.\n• Ne pas présenter un badge ou une mention de Meyana de manière trompeuse.\n• Respecter les conditions d’attribution et de maintien des badges définies par la plateforme.\n\nLes badges doivent reposer sur des critères définis, cohérents et vérifiables.\n\nUn badge de vérification indique uniquement que les contrôles annoncés par Meyana ont été effectués avec le résultat correspondant. Il ne constitue pas une garantie absolue de compétence, de résultat ou d’absence de risque.\n\nUne éventuelle mention de recommandation doit reposer sur des critères objectifs et transparents, tels que les retours d’expérience disponibles, le respect de la charte et l’absence de manquements sérieux établis.\n\nAucun praticien ne peut acheter une recommandation ou une évaluation positive. Si Meyana propose des options payantes de visibilité, celles-ci doivent être clairement distinguées des badges liés à la vérification ou à la qualité."
		},
		{
			"title": "Article 10 — Vérification, vigilance et contrôle de conformité",
			"content": "Meyana s’engage à mettre en œuvre une démarche de sélection proportionnée à la nature des activités référencées.\n\nCette démarche peut comprendre :\n\n• La vérification de l’identité du praticien.\n• L’examen des diplômes, certifications, autorisations ou justificatifs pertinents.\n• La vérification des informations relatives à l’expérience et aux prestations proposées.\n• L’examen de la conformité du profil et des pratiques déclarées à la présente charte.\n• Des demandes complémentaires de justificatifs lorsque des éléments doivent être clarifiés.\n• Le réexamen d’un référencement lorsqu’un changement de situation ou un signalement le justifie.\n\nSelon l’état de la procédure, Meyana peut distinguer les profils en cours de vérification de ceux dont les contrôles ont été achevés.\n\nLe référencement n’exonère jamais le praticien de ses obligations légales et professionnelles. Il ne constitue pas davantage une garantie permanente : les informations et les pratiques peuvent évoluer.\n\nMeyana se réserve le droit de suspendre temporairement un profil, de demander des explications ou des documents complémentaires, de retirer un badge ou de mettre fin au référencement lorsque des éléments sérieux le justifient."
		},
		{
			"title": "Article 11 — Signalements, manquements et mesures applicables",
			"content": "Tout signalement relatif à un manquement potentiel à la présente charte peut faire l’objet d’un examen par Meyana.\n\nLorsqu’un signalement est reçu, la plateforme peut, selon la nature et la gravité des faits :\n\n• Demander des précisions ou des justificatifs au praticien concerné.\n• Examiner les éléments disponibles et recueillir les observations des parties lorsque cela est approprié.\n• Demander la correction d’informations inexactes ou la cessation d’une pratique non conforme.\n• Suspendre temporairement un profil ou une prestation lorsque des mesures de précaution sont nécessaires.\n• Retirer un badge ou une mention de recommandation.\n• Refuser ou mettre fin au référencement en cas de manquement suffisamment sérieux.\n\nLes mesures prises doivent être proportionnées aux faits et tenir compte des éléments disponibles. Dans la mesure compatible avec la sécurité des utilisateurs et les obligations légales, le praticien doit pouvoir présenter ses observations.\n\nEn cas de risque sérieux pour les personnes, de fraude, de pratiques interdites ou de manquement grave à la présente charte, Meyana peut prendre des mesures immédiates, sans préjudice de ses autres obligations légales.\n\nLa plateforme peut également, lorsque la loi l’impose ou le permet, transmettre des informations aux autorités compétentes."
		},
		{
			"title": "Article 12 — Engagement et signature obligatoire du praticien",
			"content": "Le référencement sur Meyana implique l’acceptation pleine et entière de la présente charte.\n\nEn signant ce document, le praticien reconnaît :\n\n• Avoir pris connaissance de l’ensemble des dispositions de la charte.\n• Comprendre les exigences de Meyana en matière de compétence, d’intégrité, de transparence, de respect et de responsabilité.\n• S’engager à respecter ces dispositions pendant toute la durée de son référencement.\n• Fournir des informations sincères et exactes concernant son identité, ses qualifications et ses prestations.\n• Accepter que Meyana procède aux vérifications pertinentes et réexamine son référencement si nécessaire.\n• Comprendre qu’un manquement à la charte peut entraîner des mesures correctives, une suspension, le retrait d’un badge ou la fin du référencement, selon la gravité des faits."
		},
		{
			"title": "Engagement de Meyana",
			"content": "Meyana s’engage à appliquer sa démarche de sélection avec sérieux, cohérence et transparence, dans le respect de la réglementation applicable.\n\nLa plateforme veille à définir des critères de référencement compréhensibles, à effectuer les vérifications annoncées, à examiner les signalements avec vigilance et à prendre des mesures proportionnées lorsqu’un manquement est constaté.\n\nMeyana entend construire un environnement dans lequel les utilisateurs peuvent effectuer leurs recherches avec davantage de confiance, et dans lequel les praticiens référencés partagent une même exigence d’intégrité, de respect et de responsabilité.\n\nLa confiance se mérite, se vérifie et se protège.\n\nLa présente charte peut évoluer afin de tenir compte des évolutions réglementaires, des besoins des utilisateurs et des exigences de qualité de Meyana. Toute modification substantielle destinée à s’appliquer aux praticiens déjà référencés devra leur être portée à connaissance selon des modalités appropriées."
		}
	],
	"declaration": "Je déclare avoir lu et compris la Charte éthique et déontologique des praticiens de Meyana. Je m’engage à en respecter les dispositions pendant toute la durée de mon référencement et à fournir des informations exactes concernant mon activité.\n\nJe comprends que le non-respect de cette charte peut entraîner des mesures adaptées à la nature et à la gravité du manquement, pouvant aller jusqu’à la suspension ou à la cessation de mon référencement."
};

/** Version de la charte en vigueur, enregistrée avec chaque signature */
const currentCharterVersion = async (strapi) => {
	const charter = await strapi.documents(UID).findFirst({ fields: ['version'] });
	return charter?.version || FALLBACK_VERSION;
};

const ensureCharter = async (strapi) => {
	const existing = await strapi.documents(UID).findFirst({ fields: ['id'], populate: ['sections'] });
	if (!existing) await strapi.documents(UID).create({ data: INITIAL_CHARTER });
	// Charte créée avant l'arrivée des sections (ancien modèle) : texte complet ajouté une fois
	else if (!existing.sections?.length) await strapi.documents(UID).update({ documentId: existing.documentId, data: INITIAL_CHARTER });

	const publicRole = await strapi.query('plugin::users-permissions.role').findOne({ where: { type: 'public' } });
	if (!publicRole) return;
	const granted = await strapi
		.query('plugin::users-permissions.permission')
		.findOne({ where: { action: PUBLIC_ACTION, role: publicRole.id } });
	if (!granted) {
		await strapi.query('plugin::users-permissions.permission').create({ data: { action: PUBLIC_ACTION, role: publicRole.id } });
	}
};

module.exports = { ensureCharter, currentCharterVersion };
