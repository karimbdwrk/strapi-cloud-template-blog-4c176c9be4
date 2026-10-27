'use strict';

/**
 * Liste des métiers référencés par Meyana, rangés par domaine puis par famille.
 *
 * - `## <domaine> | <famille>` ouvre une famille (domaine : medical, paramedical, wellbeing) ;
 * - chaque ligne suivante : `métier | catégorie générale | métier au féminin`,
 *   soit `professionName | name | professionNameFeminine` de la catégorie Strapi.
 *   Féminin absent = identique au métier.
 *
 * Un métier présent dans plusieurs familles (Stomatologue, Thérapeute de couple…)
 * n'est créé qu'une fois et rattaché à chacune.
 */
const CATALOG = `
## medical | Médecine générale et spécialités médicales
Médecin généraliste | Médecine générale
Allergologue | Allergologie
Anesthésiste-réanimateur | Anesthésie-réanimation | Anesthésiste-réanimatrice
Algologue (médecin spécialiste de la douleur) | Médecine de la douleur
Angiologue | Angiologie
Médecin vasculaire | Médecine vasculaire
Cardiologue | Cardiologie
Dermatologue | Dermatologie
Vénérologue | Vénérologie
Endocrinologue | Endocrinologie
Diabétologue | Diabétologie
Médecin nutritionniste | Nutrition médicale
Gastro-entérologue | Gastro-entérologie
Hépatologue | Hépatologie
Néphrologue | Néphrologie
Neurologue | Neurologie
Oncologue médical | Oncologie médicale | Oncologue médicale
Hématologue | Hématologie
Pneumologue | Pneumologie
Rhumatologue | Rhumatologie
Interniste | Médecine interne
Gériatre | Gériatrie
Pédiatre | Pédiatrie
Pédopsychiatre | Pédopsychiatrie
Psychiatre | Psychiatrie
Médecin spécialiste en médecine physique et de réadaptation | Médecine physique et de réadaptation
Médecin du sport | Médecine du sport
Médecin du travail | Médecine du travail
Médecin urgentiste | Urgences
Médecin réanimateur | Réanimation
Infectiologue | Infectiologie
Médecin tropicaliste | Médecine tropicale
Immunologiste clinique | Immunologie clinique
Généticien médical | Génétique médicale | Généticienne médicale
Médecin nucléaire | Médecine nucléaire
Radiologue | Radiologie
Médecin spécialiste en radiothérapie | Radiothérapie
Médecin spécialiste en anatomie et cytologie pathologiques | Anatomie et cytologie pathologiques
Médecin spécialiste en santé publique | Santé publique
Médecin légiste | Médecine légale
Médecin spécialiste en médecine interne et immunologie clinique | Médecine interne et immunologie clinique
Médecin spécialiste en médecine cardiovasculaire | Médecine cardiovasculaire
Médecin spécialiste en médecine intensive-réanimation | Médecine intensive-réanimation
Médecin spécialiste en médecine d'urgence | Médecine d'urgence
Médecin spécialiste en médecine thermale | Médecine thermale
Médecin spécialiste en médecine de la reproduction | Médecine de la reproduction

## medical | Santé féminine et reproductive
Gynécologue médical | Gynécologie médicale | Gynécologue médicale
Gynécologue-obstétricien | Gynécologie-obstétrique | Gynécologue-obstétricienne
Médecin spécialiste de la fertilité | Fertilité
Médecin spécialiste de l'infertilité | Infertilité
Médecin spécialiste de la ménopause | Ménopause
Médecin spécialiste de l'endométriose | Endométriose
Andrologue | Andrologie
Médecin spécialiste de la santé sexuelle | Santé sexuelle

## medical | Chirurgie
Chirurgien général | Chirurgie générale | Chirurgienne générale
Chirurgien digestif | Chirurgie digestive | Chirurgienne digestive
Chirurgien viscéral | Chirurgie viscérale | Chirurgienne viscérale
Chirurgien orthopédiste | Chirurgie orthopédique | Chirurgienne orthopédiste
Chirurgien traumatologue | Traumatologie | Chirurgienne traumatologue
Neurochirurgien | Neurochirurgie | Neurochirurgienne
Chirurgien thoracique | Chirurgie thoracique | Chirurgienne thoracique
Chirurgien cardiovasculaire | Chirurgie cardiovasculaire | Chirurgienne cardiovasculaire
Chirurgien vasculaire | Chirurgie vasculaire | Chirurgienne vasculaire
Chirurgien plastique | Chirurgie plastique | Chirurgienne plastique
Chirurgien reconstructeur | Chirurgie reconstructrice | Chirurgienne reconstructrice
Chirurgien esthétique | Chirurgie esthétique | Chirurgienne esthétique
Chirurgien pédiatrique | Chirurgie pédiatrique | Chirurgienne pédiatrique
Chirurgien urologue | Urologie | Chirurgienne urologue
Chirurgien gynécologue | Chirurgie gynécologique | Chirurgienne gynécologue
Chirurgien maxillo-facial | Chirurgie maxillo-faciale | Chirurgienne maxillo-faciale
Chirurgien oral | Chirurgie orale | Chirurgienne orale
Chirurgien cervico-facial | Chirurgie cervico-faciale | Chirurgienne cervico-faciale
Chirurgien ORL | ORL | Chirurgienne ORL
Chirurgien ophtalmologue | Ophtalmologie | Chirurgienne ophtalmologue
Chirurgien oncologue | Chirurgie oncologique | Chirurgienne oncologue
Chirurgien spécialisé en transplantation | Chirurgie de transplantation | Chirurgienne spécialisée en transplantation
Stomatologue | Stomatologie

## medical | Santé bucco-dentaire
Chirurgien-dentiste | Dentaire | Chirurgienne-dentiste
Orthodontiste | Orthodontie
Pédodontiste (dentiste pédiatrique) | Pédodontie
Parodontiste | Parodontologie
Endodontiste | Endodontie
Implantologue dentaire | Implantologie dentaire
Chirurgien oral | Chirurgie orale | Chirurgienne orale
Spécialiste en médecine bucco-dentaire | Médecine bucco-dentaire
Stomatologue | Stomatologie

## medical | Pharmacie, biologie et autres professions médicales
Sage-femme | Maïeutique
Pharmacien d'officine | Pharmacie d'officine | Pharmacienne d'officine
Pharmacien hospitalier | Pharmacie hospitalière | Pharmacienne hospitalière
Pharmacien biologiste | Biologie pharmaceutique | Pharmacienne biologiste
Biologiste médical | Biologie médicale | Biologiste médicale
Médecin biologiste | Médecine biologique
Physicien médical | Physique médicale | Physicienne médicale

## paramedical | Soins infirmiers
Infirmier | Soins infirmiers | Infirmière
Infirmier en pratique avancée | Pratique infirmière avancée | Infirmière en pratique avancée
Infirmier anesthésiste | Soins infirmiers en anesthésie | Infirmière anesthésiste
Infirmier de bloc opératoire | Soins infirmiers de bloc opératoire | Infirmière de bloc opératoire
Infirmier puériculteur | Puériculture | Infirmière puéricultrice
Infirmier en santé mentale | Soins infirmiers en santé mentale | Infirmière en santé mentale
Infirmier en psychiatrie | Soins infirmiers en psychiatrie | Infirmière en psychiatrie
Infirmier en soins palliatifs | Soins palliatifs | Infirmière en soins palliatifs
Infirmier en soins à domicile | Soins infirmiers à domicile | Infirmière en soins à domicile
Infirmier en gérontologie | Soins infirmiers en gérontologie | Infirmière en gérontologie
Infirmier en santé au travail | Soins infirmiers en santé au travail | Infirmière en santé au travail
Infirmier en éducation thérapeutique | Éducation thérapeutique infirmière | Infirmière en éducation thérapeutique
Infirmier spécialisé en plaies et cicatrisation | Plaies et cicatrisation | Infirmière spécialisée en plaies et cicatrisation

## paramedical | Rééducation et réadaptation
Masseur-kinésithérapeute | Kinésithérapie | Masseuse-kinésithérapeute
Physiothérapeute | Physiothérapie
Ergothérapeute | Ergothérapie
Psychomotricien | Psychomotricité | Psychomotricienne
Orthophoniste | Orthophonie
Orthoptiste | Orthoptie
Pédicure-podologue | Podologie
Chiropracteur | Chiropraxie | Chiropractrice
Ostéopathe | Ostéopathie
Professionnel de rééducation vestibulaire | Rééducation vestibulaire | Professionnelle de rééducation vestibulaire
Professionnel de rééducation périnéale | Rééducation périnéale | Professionnelle de rééducation périnéale
Professionnel de rééducation respiratoire | Rééducation respiratoire | Professionnelle de rééducation respiratoire
Professionnel de rééducation neurologique | Rééducation neurologique | Professionnelle de rééducation neurologique

## paramedical | Nutrition et diététique
Diététicien | Diététique | Diététicienne
Diététicien-nutritionniste | Diététique et nutrition | Diététicienne-nutritionniste
Diététicien spécialisé en pédiatrie | Diététique pédiatrique | Diététicienne spécialisée en pédiatrie
Diététicien spécialisé en nutrition sportive | Nutrition sportive | Diététicienne spécialisée en nutrition sportive
Diététicien spécialisé en nutrition clinique | Nutrition clinique | Diététicienne spécialisée en nutrition clinique
Diététicien spécialisé en santé digestive | Diététique et santé digestive | Diététicienne spécialisée en santé digestive
Diététicien spécialisé en santé féminine | Diététique et santé féminine | Diététicienne spécialisée en santé féminine
Diététicien spécialisé dans les troubles du comportement alimentaire | Diététique des troubles alimentaires | Diététicienne spécialisée dans les troubles du comportement alimentaire
Diététicien spécialisé en diabétologie | Diététique et diabète | Diététicienne spécialisée en diabétologie
Diététicien spécialisé en gériatrie | Diététique gériatrique | Diététicienne spécialisée en gériatrie

## paramedical | Appareillage, audition et vision
Audioprothésiste | Audioprothèse
Opticien-lunetier | Optique-lunetterie | Opticienne-lunetière
Orthoprothésiste | Orthoprothèse
Orthopédiste-orthésiste | Orthopédie-orthèse
Podo-orthésiste | Podo-orthèse
Oculariste | Prothèse oculaire
Épithésiste | Épithèse
Prothésiste dentaire | Prothèse dentaire

## paramedical | Pharmacie, laboratoire et imagerie
Préparateur en pharmacie | Préparation en pharmacie | Préparatrice en pharmacie
Préparateur en pharmacie hospitalière | Préparation en pharmacie hospitalière | Préparatrice en pharmacie hospitalière
Technicien de laboratoire médical | Laboratoire médical | Technicienne de laboratoire médical
Manipulateur d'électroradiologie médicale | Électroradiologie médicale | Manipulatrice d'électroradiologie médicale
Technicien en analyses biomédicales | Analyses biomédicales | Technicienne en analyses biomédicales
Assistant dentaire | Assistance dentaire | Assistante dentaire
Assistant de régulation médicale | Régulation médicale | Assistante de régulation médicale

## paramedical | Soins et accompagnement médico-social
Aide-soignant | Aide-soins | Aide-soignante
Auxiliaire de puériculture | Auxiliaire de puériculture
Ambulancier | Transport sanitaire | Ambulancière
Accompagnant éducatif et social | Accompagnement éducatif et social | Accompagnante éducative et sociale
Éducateur spécialisé | Éducation spécialisée | Éducatrice spécialisée
Éducateur de jeunes enfants | Éducation de jeunes enfants | Éducatrice de jeunes enfants
Conseiller en génétique | Conseil en génétique | Conseillère en génétique
Professionnel de l'accompagnement médico-social | Accompagnement médico-social | Professionnelle de l'accompagnement médico-social

## wellbeing | Psychologie et psychothérapie
Psychologue | Psychologie
Psychologue clinicien | Psychologie clinique | Psychologue clinicienne
Neuropsychologue | Neuropsychologie
Psychologue du développement | Psychologie du développement
Psychologue de l'enfant et de l'adolescent | Psychologie de l'enfant et de l'adolescent
Psychologue du travail | Psychologie du travail
Psychologue scolaire | Psychologie scolaire
Psychologue spécialisé en gérontologie | Psychogérontologie | Psychologue spécialisée en gérontologie
Psychologue spécialisé en psychologie de la santé | Psychologie de la santé | Psychologue spécialisée en psychologie de la santé
Psychothérapeute | Psychothérapie
Psychopraticien | Psychopratique | Psychopraticienne
Thérapeute familial | Thérapie familiale | Thérapeute familiale
Thérapeute de couple | Thérapie de couple
Thérapeute spécialisé en thérapie cognitivo-comportementale (TCC) | Thérapie cognitivo-comportementale (TCC) | Thérapeute spécialisée en thérapie cognitivo-comportementale (TCC)
Thérapeute spécialisé en thérapie des schémas | Thérapie des schémas | Thérapeute spécialisée en thérapie des schémas
Thérapeute spécialisé en ACT | Thérapie d'acceptation et d'engagement (ACT) | Thérapeute spécialisée en ACT
Thérapeute spécialisé en DBT | Thérapie comportementale dialectique (DBT) | Thérapeute spécialisée en DBT
Thérapeute spécialisé en EMDR | EMDR | Thérapeute spécialisée en EMDR
Thérapeute spécialisé en thérapie systémique | Thérapie systémique | Thérapeute spécialisée en thérapie systémique
Thérapeute spécialisé en thérapie centrée sur la personne | Thérapie centrée sur la personne | Thérapeute spécialisée en thérapie centrée sur la personne
Thérapeute spécialisé en thérapie interpersonnelle | Thérapie interpersonnelle | Thérapeute spécialisée en thérapie interpersonnelle
Thérapeute spécialisé dans les traumatismes | Thérapie des traumatismes | Thérapeute spécialisée dans les traumatismes
Thérapeute spécialisé dans le deuil | Accompagnement du deuil | Thérapeute spécialisée dans le deuil
Thérapeute spécialisé dans les troubles anxieux | Thérapie des troubles anxieux | Thérapeute spécialisée dans les troubles anxieux
Thérapeute spécialisé dans les troubles du comportement alimentaire | Thérapie des troubles alimentaires | Thérapeute spécialisée dans les troubles du comportement alimentaire
Thérapeute spécialisé dans les troubles du sommeil | Thérapie des troubles du sommeil | Thérapeute spécialisée dans les troubles du sommeil
Thérapeute spécialisé dans les difficultés relationnelles | Thérapie des difficultés relationnelles | Thérapeute spécialisée dans les difficultés relationnelles
Thérapeute spécialisé dans l'accompagnement parental | Thérapie et accompagnement parental | Thérapeute spécialisée dans l'accompagnement parental
Thérapeute spécialisé dans l'accompagnement des enfants | Thérapie de l'enfant | Thérapeute spécialisée dans l'accompagnement des enfants

## wellbeing | Naturopathie et hygiène de vie
Naturopathe | Naturopathie
Conseiller en naturopathie | Conseil en naturopathie | Conseillère en naturopathie
Praticien en hygiène de vie | Hygiène de vie | Praticienne en hygiène de vie
Conseiller en santé naturelle | Santé naturelle | Conseillère en santé naturelle
Conseiller en phytothérapie | Conseil en phytothérapie | Conseillère en phytothérapie
Praticien en phytothérapie | Phytothérapie | Praticienne en phytothérapie
Conseiller en aromathérapie | Conseil en aromathérapie | Conseillère en aromathérapie
Praticien en aromathérapie | Aromathérapie | Praticienne en aromathérapie
Herboriste | Herboristerie
Conseiller en micronutrition | Conseil en micronutrition | Conseillère en micronutrition
Praticien en micronutrition | Micronutrition | Praticienne en micronutrition
Conseiller en oligothérapie | Oligothérapie | Conseillère en oligothérapie
Conseiller en gemmothérapie | Gemmothérapie | Conseillère en gemmothérapie
Conseiller en hygiène alimentaire | Hygiène alimentaire | Conseillère en hygiène alimentaire
Éducateur en santé naturelle | Éducation en santé naturelle | Éducatrice en santé naturelle

## wellbeing | Pratiques manuelles et corporelles
Praticien en hijama | Hijama | Praticienne en hijama
Praticien en ventouses sèches | Ventouses sèches | Praticienne en ventouses sèches
Praticien en ventouses humides | Ventouses humides | Praticienne en ventouses humides
Praticien en acupuncture | Acupuncture | Praticienne en acupuncture
Praticien en auriculothérapie | Auriculothérapie | Praticienne en auriculothérapie
Praticien en acupression | Acupression | Praticienne en acupression
Praticien en digitopuncture | Digitopuncture | Praticienne en digitopuncture
Réflexologue | Réflexologie
Réflexologue plantaire | Réflexologie plantaire
Réflexologue palmaire | Réflexologie palmaire
Réflexologue facial | Réflexologie faciale | Réflexologue faciale
Praticien en massage bien-être | Massage bien-être | Praticienne en massage bien-être
Praticien en massage relaxant | Massage relaxant | Praticienne en massage relaxant
Praticien en massage sportif | Massage sportif | Praticienne en massage sportif
Praticien en massage prénatal | Massage prénatal | Praticienne en massage prénatal
Praticien en massage postnatal | Massage postnatal | Praticienne en massage postnatal
Praticien en massage bébé | Massage bébé | Praticienne en massage bébé
Praticien en massage crânien | Massage crânien | Praticienne en massage crânien
Praticien en massage du visage | Massage du visage | Praticienne en massage du visage
Praticien en massage assis | Massage assis | Praticienne en massage assis
Praticien en drainage bien-être | Drainage bien-être | Praticienne en drainage bien-être
Praticien en relaxation corporelle | Relaxation corporelle | Praticienne en relaxation corporelle
Praticien en techniques manuelles de détente | Techniques manuelles de détente | Praticienne en techniques manuelles de détente

## wellbeing | Relaxation et gestion du stress
Sophrologue | Sophrologie
Relaxologue | Relaxologie
Praticien en méditation | Méditation | Praticienne en méditation
Instructeur en pleine conscience | Pleine conscience | Instructrice en pleine conscience
Praticien en respiration consciente | Respiration consciente | Praticienne en respiration consciente
Coach en gestion du stress | Gestion du stress
Coach en gestion des émotions | Gestion des émotions
Praticien en relaxation musculaire | Relaxation musculaire | Praticienne en relaxation musculaire
Accompagnant au sommeil | Accompagnement du sommeil | Accompagnante au sommeil
Coach sommeil | Coaching sommeil
Accompagnant en gestion du surmenage | Gestion du surmenage | Accompagnante en gestion du surmenage
Praticien en techniques de visualisation | Visualisation | Praticienne en techniques de visualisation

## wellbeing | Coaching personnel et développement personnel
Coach de vie | Coaching de vie
Coach en développement personnel | Développement personnel
Coach en estime de soi | Estime de soi
Coach en affirmation de soi | Affirmation de soi
Coach en organisation personnelle | Organisation personnelle
Coach en gestion du temps | Gestion du temps
Coach en motivation | Motivation
Coach en habitudes et routines | Habitudes et routines
Coach en prise de décision | Prise de décision
Coach en changement de vie | Changement de vie
Coach en équilibre de vie | Équilibre de vie
Coach en communication | Communication
Coach en prise de parole | Prise de parole
Coach en leadership personnel | Leadership personnel
Coach en préparation à un objectif | Préparation à un objectif
Coach en transitions de vie | Transitions de vie
Coach en reconversion personnelle | Reconversion personnelle

## wellbeing | Coaching familial et parental
Coach parental | Coaching parental | Coach parentale
Coach familial | Coaching familial | Coach familiale
Accompagnant en parentalité | Accompagnement en parentalité | Accompagnante en parentalité
Conseiller parental | Conseil parental | Conseillère parentale
Coach en communication parents-enfants | Communication parents-enfants
Coach en éducation | Coaching en éducation
Coach en organisation familiale | Organisation familiale
Accompagnant des parents d'adolescents | Parents d'adolescents | Accompagnante des parents d'adolescents
Accompagnant des familles recomposées | Familles recomposées | Accompagnante des familles recomposées
Accompagnant dans les conflits familiaux | Conflits familiaux | Accompagnante dans les conflits familiaux
Accompagnant des parents d'enfants à besoins particuliers | Enfants à besoins particuliers | Accompagnante des parents d'enfants à besoins particuliers
Conseiller conjugal et familial | Conseil conjugal et familial | Conseillère conjugale et familiale
Médiateur familial | Médiation familiale | Médiatrice familiale

## wellbeing | Couple, sexualité et relations
Coach de couple | Coaching de couple
Coach relationnel | Coaching relationnel | Coach relationnelle
Coach en communication de couple | Communication de couple
Coach en gestion des conflits | Gestion des conflits
Coach en préparation au mariage | Préparation au mariage
Coach en accompagnement de séparation | Accompagnement de la séparation
Coach en relations affectives | Relations affectives
Coach en intimité | Intimité
Sexologue | Sexologie
Sexothérapeute | Sexothérapie
Conseiller en vie affective et sexuelle | Vie affective et sexuelle | Conseillère en vie affective et sexuelle
Thérapeute de couple | Thérapie de couple
Conseiller conjugal | Conseil conjugal | Conseillère conjugale

## wellbeing | Coaching scolaire et accompagnement éducatif
Coach scolaire | Coaching scolaire
Coach étudiant | Coaching étudiant | Coach étudiante
Coach en méthodologie | Méthodologie
Coach en organisation des études | Organisation des études
Coach en motivation scolaire | Motivation scolaire
Coach en préparation aux examens | Préparation aux examens
Coach en orientation scolaire | Orientation scolaire
Coach en orientation professionnelle | Orientation professionnelle
Coach en mémorisation | Mémorisation
Coach en stratégies d'apprentissage | Stratégies d'apprentissage
Coach en gestion du stress scolaire | Stress scolaire
Coach en prise de parole | Prise de parole
Accompagnant scolaire | Accompagnement scolaire | Accompagnante scolaire
Accompagnant à la scolarité | Accompagnement à la scolarité | Accompagnante à la scolarité
Accompagnant dans les difficultés d'apprentissage | Difficultés d'apprentissage | Accompagnante dans les difficultés d'apprentissage
Consultant en orientation | Conseil en orientation | Consultante en orientation
Conseiller d'orientation | Orientation | Conseillère d'orientation
Graphothérapeute | Graphothérapie

## wellbeing | Coaching professionnel et entrepreneurial
Coach professionnel | Coaching professionnel | Coach professionnelle
Coach de carrière | Coaching de carrière
Coach en reconversion professionnelle | Reconversion professionnelle
Coach en recherche d'emploi | Recherche d'emploi
Coach en entretien d'embauche | Entretien d'embauche
Coach en prise de poste | Prise de poste
Coach en management | Management
Coach de dirigeants | Coaching de dirigeants
Coach en leadership | Leadership
Coach en communication professionnelle | Communication professionnelle
Coach en productivité | Productivité
Coach en organisation professionnelle | Organisation professionnelle
Coach en création d'entreprise | Création d'entreprise
Coach en entrepreneuriat | Entrepreneuriat
Coach en équilibre vie professionnelle-vie personnelle | Équilibre vie professionnelle-vie personnelle
Coach en prévention du surmenage professionnel | Prévention du surmenage professionnel

## wellbeing | Coaching sportif et mouvement
Coach sportif | Coaching sportif | Coach sportive
Coach fitness | Fitness
Coach en remise en forme | Remise en forme
Coach en musculation | Musculation
Coach en préparation physique | Préparation physique
Coach en endurance | Endurance
Coach en course à pied | Course à pied
Coach en mobilité | Mobilité
Coach en souplesse | Souplesse
Coach en renforcement musculaire | Renforcement musculaire
Coach en récupération sportive | Récupération sportive
Coach en activité physique adaptée | Activité physique adaptée
Professeur de Pilates | Pilates | Professeure de Pilates
Professeur de stretching | Stretching | Professeure de stretching
Instructeur en relaxation corporelle | Enseignement de la relaxation corporelle | Instructrice en relaxation corporelle

## wellbeing | Grossesse, maternité et petite enfance
Doula | Accompagnement par une doula
Accompagnant périnatal | Accompagnement périnatal | Accompagnante périnatale
Accompagnant à la naissance | Accompagnement à la naissance | Accompagnante à la naissance
Accompagnant postnatal | Accompagnement postnatal | Accompagnante postnatale
Consultant en lactation | Lactation | Consultante en lactation
Consultant en allaitement | Allaitement | Consultante en allaitement
Conseiller en portage physiologique | Portage physiologique | Conseillère en portage physiologique
Accompagnant au sommeil du bébé | Sommeil du bébé | Accompagnante au sommeil du bébé
Accompagnant au massage bébé | Accompagnement au massage bébé | Accompagnante au massage bébé
Accompagnant à la parentalité | Accompagnement à la parentalité | Accompagnante à la parentalité
Accompagnant au retour à la maison après la naissance | Retour à la maison après la naissance | Accompagnante au retour à la maison après la naissance
Accompagnant dans l'organisation familiale après la naissance | Organisation familiale après la naissance | Accompagnante dans l'organisation familiale après la naissance

## wellbeing | Handicap, autonomie et aidants
Accompagnant à l'autonomie | Accompagnement à l'autonomie | Accompagnante à l'autonomie
Accompagnant des personnes en situation de handicap | Handicap | Accompagnante des personnes en situation de handicap
Accompagnant des aidants familiaux | Aidants familiaux | Accompagnante des aidants familiaux
Consultant en adaptation du quotidien | Adaptation du quotidien | Consultante en adaptation du quotidien
Conseiller en accessibilité | Accessibilité | Conseillère en accessibilité
Accompagnant des personnes âgées | Accompagnement des personnes âgées | Accompagnante des personnes âgées
Accompagnant dans les transitions de vie liées au handicap | Transitions de vie liées au handicap | Accompagnante dans les transitions de vie liées au handicap
Accompagnant éducatif et social | Accompagnement éducatif et social | Accompagnante éducative et sociale

## wellbeing | Éducation et prévention
Éducateur en santé | Éducation pour la santé | Éducatrice en santé
Intervenant en prévention santé | Prévention santé | Intervenante en prévention santé
Éducateur en activité physique | Éducation à l'activité physique | Éducatrice en activité physique
Formateur en premiers secours | Premiers secours | Formatrice en premiers secours
Éducateur à la vie affective et sexuelle | Éducation à la vie affective et sexuelle | Éducatrice à la vie affective et sexuelle
Intervenant en éducation thérapeutique | Éducation thérapeutique | Intervenante en éducation thérapeutique
Formateur en hygiène de vie | Formation en hygiène de vie | Formatrice en hygiène de vie
Animateur d'ateliers de bien-être | Ateliers de bien-être | Animatrice d'ateliers de bien-être
`;

const DOMAINS = ['medical', 'paramedical', 'wellbeing'];

/** Familles dans l'ordre de la liste : [{ domain, name, order, professions: [{ professionName, name, professionNameFeminine }] }] */
const parseCatalog = () => {
	const families = [];
	for (const raw of CATALOG.split('\n')) {
		const line = raw.trim();
		if (!line) continue;
		if (line.startsWith('## ')) {
			const [domain, name] = line.slice(3).split('|').map((s) => s.trim());
			if (!DOMAINS.includes(domain)) throw new Error(`Domaine inconnu dans le catalogue des métiers : ${domain}`);
			families.push({ domain, name, order: families.length + 1, professions: [] });
			continue;
		}
		const [professionName, name, feminine] = line.split('|').map((s) => s.trim());
		families.at(-1).professions.push({ professionName, name, professionNameFeminine: feminine || professionName });
	}
	return families;
};

module.exports = { parseCatalog, DOMAINS };
