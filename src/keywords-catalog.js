'use strict';

/**
 * Liste Meyana des mots-clés de recherche (première version, à relire).
 *
 * - `## <type> | <titre>` ouvre un groupe ; type : symptom (symptôme ou trouble),
 *   reason (motif de consultation), approach (approche ou méthode), audience (public accompagné).
 *   Le titre sert seulement à la relecture.
 * - chaque ligne : `mot-clé | synonymes séparés par des virgules | métiers suggérés`
 *   métiers : slugs de catégories (« kinesitherapie ») ou `*famille` pour toute une famille
 *   (« *coaching-sportif-et-mouvement »), séparés par des espaces.
 * - `!` devant le mot-clé : mot-clé sensible (maladie, trouble grave), réservé aux métiers
 *   du domaine médical et aux métiers suggérés sur la ligne.
 *
 * Les mots-clés suggérés pour un métier sont proposés en premier au praticien,
 * et un patient qui cherche le mot-clé trouve aussi les praticiens de ces métiers.
 */
const CATALOG = `
## symptom | Douleurs et appareil locomoteur
Mal de dos | lombalgie, douleurs dorsales, lumbago, dorsalgie, tour de reins | kinesitherapie physiotherapie osteopathie chiropraxie rhumatologie medecine-generale medecine-physique-et-de-readaptation
Sciatique | nerf sciatique, cruralgie, douleur dans la jambe | kinesitherapie osteopathie chiropraxie rhumatologie medecine-physique-et-de-readaptation
Douleurs cervicales | cervicalgie, torticolis, mal au cou, nuque raide | kinesitherapie osteopathie chiropraxie rhumatologie
Douleurs articulaires | arthralgie, mal aux articulations, raideurs | rhumatologie kinesitherapie osteopathie medecine-generale
Arthrose | usure du cartilage, gonarthrose, coxarthrose | rhumatologie kinesitherapie chirurgie-orthopedique medecine-physique-et-de-readaptation
Tendinite | tendinopathie, épicondylite, tennis elbow, inflammation du tendon | kinesitherapie medecine-du-sport osteopathie rhumatologie massage-sportif
Entorse | foulure, entorse de la cheville, ligament | kinesitherapie medecine-du-sport traumatologie medecine-generale
Douleurs musculaires | courbatures, contractures, crampes, myalgie | kinesitherapie massage-sportif osteopathie medecine-du-sport recuperation-sportive
Douleurs chroniques | douleur persistante, douleur qui dure | medecine-de-la-douleur rhumatologie kinesitherapie psychologie-de-la-sante sophrologie
!Fibromyalgie | syndrome fibromyalgique, douleurs diffuses | medecine-de-la-douleur rhumatologie kinesitherapie psychologie-de-la-sante
Scoliose | déviation de la colonne, dos voûté, cyphose | kinesitherapie chirurgie-orthopedique orthopedie-orthese osteopathie
Douleurs aux pieds | mal aux pieds, épine calcanéenne, aponévrosite plantaire, hallux valgus, oignon | podologie podo-orthese chirurgie-orthopedique kinesitherapie
Douleurs à l'épaule | épaule bloquée, capsulite, coiffe des rotateurs | kinesitherapie osteopathie rhumatologie chirurgie-orthopedique
Douleurs au genou | mal au genou, ménisque, ligament croisé | kinesitherapie chirurgie-orthopedique medecine-du-sport rhumatologie
Mâchoire douloureuse | bruxisme, ATM, serrer les dents, grincement des dents | dentaire osteopathie kinesitherapie orthodontie chirurgie-maxillo-faciale
Fracture | os cassé, plâtre, consolidation | traumatologie chirurgie-orthopedique kinesitherapie medecine-generale
!Ostéoporose | fragilité osseuse, perte de densité osseuse | rhumatologie gynecologie-medicale medecine-generale geriatrie

## symptom | Tête, nerfs et sommeil
Maux de tête | céphalées, mal de tête, mal au crâne | medecine-generale neurologie osteopathie acupuncture
Migraine | migraines, crise de migraine, migraine ophtalmique | neurologie medecine-generale osteopathie acupuncture medecine-de-la-douleur
Vertiges | étourdissements, tête qui tourne, vertige positionnel | orl neurologie reeducation-vestibulaire kinesitherapie medecine-generale
Acouphènes | sifflements dans les oreilles, bourdonnements | orl audioprothese sophrologie
Insomnie | troubles du sommeil, difficultés à dormir, réveils nocturnes, mal dormir | medecine-generale therapie-des-troubles-du-sommeil accompagnement-du-sommeil coaching-sommeil sophrologie psychologie
Fatigue | épuisement, manque d'énergie, coup de fatigue, fatigue chronique | medecine-generale naturopathie micronutrition dietetique sophrologie
Ronflements | ronfler, apnée du sommeil légère | orl medecine-generale pneumologie
!Apnée du sommeil | apnées, SAOS, arrêts respiratoires la nuit | pneumologie orl neurologie medecine-generale
Troubles de la mémoire | oublis, perte de mémoire, trous de mémoire | neurologie neuropsychologie geriatrie orthophonie
!Épilepsie | crises d'épilepsie, convulsions | neurologie pediatrie
!Maladie de Parkinson | parkinson, tremblements | neurologie geriatrie kinesitherapie orthophonie reeducation-neurologique
!Maladie d'Alzheimer | alzheimer, démence, troubles cognitifs | neurologie geriatrie neuropsychologie orthophonie psychogerontologie
!Sclérose en plaques | SEP | neurologie kinesitherapie reeducation-neurologique ergotherapie
!AVC | accident vasculaire cérébral, séquelles d'AVC, hémiplégie | neurologie kinesitherapie orthophonie ergotherapie reeducation-neurologique medecine-physique-et-de-readaptation
Fourmillements | engourdissements, picotements, canal carpien | neurologie medecine-generale chirurgie-orthopedique kinesitherapie

## symptom | Santé mentale et émotions
Stress | anxiété au quotidien, pression, nervosité, tension nerveuse | sophrologie gestion-du-stress psychologie relaxologie meditation pleine-conscience coaching-de-vie
Anxiété | angoisse, crises d'angoisse, attaques de panique, anxieux | psychologie psychologie-clinique psychotherapie therapie-des-troubles-anxieux therapie-cognitivo-comportementale-tcc psychiatrie sophrologie
!Dépression | état dépressif, déprime, tristesse persistante, idées noires | psychiatrie psychologie psychologie-clinique psychotherapie medecine-generale therapie-cognitivo-comportementale-tcc
Burn-out | épuisement professionnel, surmenage, burnout | psychologie psychologie-du-travail gestion-du-surmenage prevention-du-surmenage-professionnel sophrologie medecine-du-travail medecine-generale
Phobies | peur irrationnelle, phobie sociale, peur de l'avion, claustrophobie | psychologie therapie-cognitivo-comportementale-tcc therapie-des-troubles-anxieux psychotherapie emdr
Troubles obsessionnels compulsifs | TOC, obsessions, compulsions, rituels | psychiatrie psychologie therapie-cognitivo-comportementale-tcc
Traumatisme | stress post-traumatique, TSPT, choc émotionnel, événement traumatisant | psychologie emdr therapie-des-traumatismes psychiatrie psychotherapie
Deuil | perte d'un proche, décès, accompagnement du deuil, chagrin | accompagnement-du-deuil psychologie psychotherapie
Manque de confiance en soi | estime de soi, timidité, se dévaloriser, complexes | estime-de-soi affirmation-de-soi psychologie coaching-de-vie developpement-personnel
Gestion des émotions | colère, hypersensibilité, émotions envahissantes, irritabilité | gestion-des-emotions psychologie sophrologie therapie-comportementale-dialectique-dbt coaching-de-vie
!Troubles bipolaires | bipolarité, troubles de l'humeur, maniaco-dépression | psychiatrie psychologie-clinique
!Addictions | dépendance, addiction à l'alcool, tabac, cannabis, jeux, écrans | psychiatrie psychologie medecine-generale therapie-cognitivo-comportementale-tcc
Arrêt du tabac | arrêter de fumer, sevrage tabagique, cigarette | medecine-generale pneumologie psychologie acupuncture auriculotherapie sophrologie
Addiction aux écrans | dépendance au téléphone, réseaux sociaux, jeux vidéo | psychologie therapie-cognitivo-comportementale-tcc coaching-parental
Solitude | isolement, se sentir seul | psychologie coaching-de-vie therapie-des-difficultes-relationnelles
Charge mentale | surcharge, trop de choses à gérer, débordé | coaching-de-vie organisation-personnelle organisation-familiale gestion-du-stress psychologie
!Idées suicidaires | pensées suicidaires, envie de mourir | psychiatrie psychologie psychologie-clinique medecine-generale
Hyperactivité | TDAH, trouble de l'attention, déficit d'attention, impulsivité | psychiatrie pedopsychiatrie neuropsychologie psychomotricite pediatrie
!Autisme | TSA, troubles du spectre autistique, Asperger | pedopsychiatrie psychiatrie psychologie-du-developpement neuropsychologie orthophonie psychomotricite education-specialisee
Haut potentiel | HPI, surdoué, zèbre, douance | psychologie neuropsychologie psychologie-de-l-enfant-et-de-l-adolescent

## symptom | Alimentation, digestion et poids
Troubles digestifs | ballonnements, digestion difficile, gaz, lourdeurs | gastro-enterologie medecine-generale dietetique dietetique-et-sante-digestive naturopathie micronutrition
Reflux gastrique | RGO, brûlures d'estomac, remontées acides, aigreurs | gastro-enterologie medecine-generale dietetique-et-sante-digestive
Constipation | transit lent, troubles du transit | gastro-enterologie medecine-generale dietetique dietetique-et-sante-digestive naturopathie
Syndrome de l'intestin irritable | côlon irritable, colopathie fonctionnelle, SII | gastro-enterologie dietetique-et-sante-digestive dietetique
!Maladie de Crohn | MICI, rectocolite hémorragique, RCH | gastro-enterologie dietetique-et-sante-digestive nutrition-clinique
Intolérances alimentaires | intolérance au lactose, sensibilité au gluten, FODMAP | dietetique dietetique-et-sante-digestive gastro-enterologie allergologie micronutrition
!Maladie cœliaque | intolérance au gluten, régime sans gluten | gastro-enterologie dietetique dietetique-et-sante-digestive
Perte de poids | maigrir, perdre du poids, mincir, rééquilibrage alimentaire | dietetique dietetique-et-nutrition nutrition-medicale coaching-sportif remise-en-forme
Surpoids | kilos en trop, prise de poids | dietetique dietetique-et-nutrition nutrition-medicale medecine-generale endocrinologie
!Obésité | obésité sévère, chirurgie bariatrique, sleeve, bypass | nutrition-medicale endocrinologie dietetique nutrition-clinique chirurgie-digestive chirurgie-viscerale
Prise de masse | prendre du poids, gagner du muscle | nutrition-sportive musculation coaching-sportif dietetique
!Troubles du comportement alimentaire | TCA, anorexie, boulimie, hyperphagie, compulsions alimentaires | dietetique-des-troubles-alimentaires therapie-des-troubles-alimentaires psychiatrie psychologie nutrition-medicale
Grignotage | fringales, envies de sucre, manger ses émotions | dietetique dietetique-et-nutrition psychologie hygiene-alimentaire
Rééquilibrage alimentaire | manger équilibré, alimentation saine, bien manger | dietetique dietetique-et-nutrition naturopathie hygiene-alimentaire micronutrition
!Diabète | diabète de type 1, diabète de type 2, glycémie, prédiabète | diabetologie endocrinologie medecine-generale dietetique-et-diabete education-therapeutique-infirmiere soins-infirmiers
!Cholestérol | hypercholestérolémie, lipides, triglycérides | medecine-generale cardiologie endocrinologie dietetique
Carences | carence en fer, vitamine D, magnésium, anémie | medecine-generale micronutrition dietetique hematologie
Alimentation végétarienne | végétarien, végétalien, vegan, flexitarien | dietetique dietetique-et-nutrition micronutrition

## symptom | Cœur, respiration et circulation
!Hypertension | tension artérielle élevée, hypertension artérielle, HTA | cardiologie medecine-generale nephrologie
Palpitations | cœur qui bat vite, tachycardie, arythmie | cardiologie medecine-generale
Essoufflement | souffle court, difficultés à respirer, dyspnée | pneumologie cardiologie medecine-generale reeducation-respiratoire
!Asthme | crise d'asthme, sifflements respiratoires | pneumologie allergologie pediatrie medecine-generale reeducation-respiratoire
!BPCO | bronchite chronique, emphysème, insuffisance respiratoire | pneumologie reeducation-respiratoire kinesitherapie
Toux persistante | toux chronique, toux qui ne passe pas | pneumologie medecine-generale orl
Jambes lourdes | insuffisance veineuse, varices, circulation sanguine | angiologie medecine-vasculaire chirurgie-vasculaire medecine-generale
!Insuffisance cardiaque | cœur fatigué, œdème | cardiologie medecine-cardiovasculaire
Bronchiolite | encombrement bronchique du nourrisson | pediatrie kinesitherapie reeducation-respiratoire

## symptom | Peau, cheveux et allergies
Acné | boutons, points noirs, acné hormonale | dermatologie medecine-generale
Eczéma | dermatite atopique, peau sèche qui gratte, démangeaisons | dermatologie allergologie pediatrie
Psoriasis | plaques rouges, desquamation | dermatologie
Chute de cheveux | alopécie, perte de cheveux, calvitie | dermatologie endocrinologie
Grains de beauté | naevus, surveillance de la peau, taches sur la peau | dermatologie
Mycose | champignons, mycose des ongles, mycose vaginale | dermatologie medecine-generale gynecologie-medicale
Allergies | allergie, réaction allergique, urticaire | allergologie dermatologie medecine-generale
Rhume des foins | allergie aux pollens, rhinite allergique, éternuements | allergologie orl medecine-generale
Allergies alimentaires | allergie aux arachides, allergie au lait | allergologie pediatrie dietetique
Cicatrisation | plaie, ulcère, escarre, cicatrice | plaies-et-cicatrisation soins-infirmiers dermatologie soins-infirmiers-a-domicile
Rides | vieillissement de la peau, rajeunissement | dermatologie chirurgie-esthetique
Transpiration excessive | hyperhidrose, sueurs | dermatologie medecine-generale

## symptom | Yeux, oreilles, nez, gorge et bouche
Baisse de la vue | vision floue, myopie, presbytie, astigmatisme | ophtalmologie orthoptie optique-lunetterie
Yeux secs | sécheresse oculaire, yeux qui piquent | ophtalmologie
Strabisme | yeux qui louchent, loucher | ophtalmologie orthoptie
Fatigue visuelle | écrans, yeux fatigués | orthoptie ophtalmologie optique-lunetterie
Baisse de l'audition | malentendant, surdité, mal entendre, appareil auditif | orl audioprothese
Otites | otite, mal d'oreille, infection de l'oreille | orl pediatrie medecine-generale
Sinusite | nez bouché, sinus, rhinosinusite | orl medecine-generale allergologie
Angine | mal de gorge, pharyngite, amygdales | medecine-generale orl pediatrie
Mal de dents | douleur dentaire, rage de dents, sensibilité dentaire | dentaire endodontie medecine-bucco-dentaire
Caries | carie dentaire, dent abîmée | dentaire pedodontie
Saignement des gencives | gingivite, parodontite, déchaussement | parodontologie dentaire
Dents mal alignées | dents de travers, appareil dentaire, aligneurs | orthodontie dentaire
Dent manquante | implant dentaire, couronne, bridge, prothèse | implantologie-dentaire dentaire prothese-dentaire
Blanchiment des dents | dents jaunes, éclaircissement dentaire | dentaire
Troubles de la voix | voix enrouée, dysphonie, extinction de voix | orl orthophonie

## symptom | Santé urinaire, féminine et masculine
Règles douloureuses | dysménorrhée, douleurs menstruelles, crampes pendant les règles | gynecologie-medicale medecine-generale maieutique osteopathie
Cycle irrégulier | règles irrégulières, absence de règles, aménorrhée | gynecologie-medicale endocrinologie maieutique
Syndrome prémenstruel | SPM, troubles avant les règles | gynecologie-medicale maieutique dietetique-et-sante-feminine naturopathie
!Endométriose | endométriose, adénomyose | endometriose gynecologie-medicale gynecologie-obstetrique chirurgie-gynecologique
!Syndrome des ovaires polykystiques | SOPK, ovaires polykystiques | gynecologie-medicale endocrinologie dietetique-et-sante-feminine
Bouffées de chaleur | ménopause, préménopause, périménopause, sueurs nocturnes | menopause gynecologie-medicale maieutique dietetique-et-sante-feminine
Fuites urinaires | incontinence urinaire, vessie, perte d'urine | reeducation-perineale urologie maieutique kinesitherapie gynecologie-medicale
Infections urinaires | cystite, brûlures urinaires | medecine-generale urologie gynecologie-medicale
Troubles de l'érection | dysfonction érectile, impuissance, panne sexuelle | urologie andrologie sexologie sante-sexuelle
Éjaculation précoce | éjaculation rapide | sexologie andrologie urologie sexotherapie
Baisse du désir | libido, perte de désir, baisse de libido | sexologie sexotherapie sante-sexuelle gynecologie-medicale
Douleurs pendant les rapports | dyspareunie, vaginisme | sexologie gynecologie-medicale maieutique reeducation-perineale
!Infections sexuellement transmissibles | IST, MST, dépistage, VIH, chlamydia | venerologie medecine-generale gynecologie-medicale sante-sexuelle infectiologie
Problèmes de prostate | prostate, uriner souvent la nuit | urologie
!Infertilité | difficultés à concevoir, problème de fertilité, désir d'enfant | infertilite fertilite gynecologie-medicale medecine-de-la-reproduction andrologie
Mycoses vaginales | vaginose, pertes blanches, démangeaisons intimes | gynecologie-medicale maieutique medecine-generale

## symptom | Autres troubles médicaux
!Troubles de la thyroïde | hypothyroïdie, hyperthyroïdie, thyroïde, nodule thyroïdien | endocrinologie medecine-generale
!Cancer | oncologie, tumeur, chimiothérapie, après-cancer | oncologie-medicale chirurgie-oncologique radiotherapie hematologie soins-palliatifs
Accompagnement pendant un cancer | soins de support, effets secondaires des traitements, fatigue liée au cancer | psychologie-de-la-sante dietetique sophrologie soins-palliatifs activite-physique-adaptee
!Insuffisance rénale | reins, dialyse, calculs rénaux | nephrologie urologie
Calculs rénaux | coliques néphrétiques, cailloux dans les reins | urologie nephrologie medecine-generale
!Maladies auto-immunes | lupus, polyarthrite rhumatoïde, auto-immunité | medecine-interne rhumatologie immunologie-clinique
!Hépatite | hépatite B, hépatite C, foie | hepatologie gastro-enterologie infectiologie
Fièvre | température, fièvre persistante | medecine-generale pediatrie
!Covid long | covid persistant, séquelles du covid | medecine-generale pneumologie infectiologie reeducation-respiratoire
!Maladie de Lyme | piqûre de tique, borréliose | infectiologie medecine-generale
Troubles hormonaux | hormones, déséquilibre hormonal | endocrinologie gynecologie-medicale
Hémorroïdes | crise hémorroïdaire | gastro-enterologie medecine-generale chirurgie-digestive

## symptom | Enfance et développement
Retard de langage | enfant qui ne parle pas, parle mal, retard de parole | orthophonie pediatrie psychologie-du-developpement
Bégaiement | bégayer, troubles de la fluence | orthophonie
Troubles des apprentissages | dyslexie, dysorthographie, dyscalculie, dyspraxie, dys | orthophonie neuropsychologie psychomotricite ergotherapie difficultes-d-apprentissage accompagnement-scolaire
Troubles de l'écriture | dysgraphie, écriture illisible, mal écrire | graphotherapie psychomotricite ergotherapie
Difficultés scolaires | décrochage scolaire, mauvaises notes, échec scolaire | coaching-scolaire accompagnement-scolaire methodologie psychologie-scolaire difficultes-d-apprentissage
Phobie scolaire | refus scolaire, angoisse de l'école | psychologie-de-l-enfant-et-de-l-adolescent pedopsychiatrie psychologie-scolaire
Sommeil de l'enfant | bébé qui ne dort pas, réveils nocturnes de l'enfant, cauchemars | sommeil-du-bebe pediatrie psychologie-de-l-enfant-et-de-l-adolescent accompagnement-du-sommeil
Pipi au lit | énurésie, fuites nocturnes de l'enfant | pediatrie urologie psychologie-de-l-enfant-et-de-l-adolescent
Coliques du nourrisson | pleurs du bébé, bébé qui pleure | pediatrie osteopathie massage-bebe
Plagiocéphalie | tête plate du bébé, torticolis du nourrisson | osteopathie kinesitherapie pediatrie
Retard de développement | retard psychomoteur, éveil de l'enfant | pediatrie psychomotricite psychologie-du-developpement
Crises de colère de l'enfant | colères, opposition, enfant difficile | coaching-parental psychologie-de-l-enfant-et-de-l-adolescent therapie-de-l-enfant conseil-parental

## reason | Consultations et examens courants
Bilan de santé | check-up, examen de santé, bilan complet | medecine-generale
Certificat médical | certificat de sport, certificat d'aptitude, licence sportive | medecine-generale medecine-du-sport
Vaccination | vaccin, rappel de vaccin, vaccins de voyage | medecine-generale pediatrie soins-infirmiers maieutique pharmacie-d-officine medecine-tropicale
Renouvellement d'ordonnance | ordonnance, traitement de fond, renouvellement | medecine-generale
Prise de sang | bilan sanguin, analyses, prélèvement | soins-infirmiers laboratoire-medical biologie-medicale soins-infirmiers-a-domicile
Soins à domicile | infirmière à domicile, pansements, injections | soins-infirmiers-a-domicile soins-infirmiers
Consultation de voyage | conseils avant un voyage, paludisme, médecine des voyages | medecine-tropicale infectiologie medecine-generale
Dépistage | dépistage du cancer, frottis, mammographie, coloscopie | medecine-generale gynecologie-medicale maieutique radiologie gastro-enterologie
Frottis | dépistage du col de l'utérus, HPV | gynecologie-medicale maieutique medecine-generale
Contraception | pilule, stérilet, implant, DIU | gynecologie-medicale maieutique medecine-generale
Échographie | écho, imagerie | radiologie gynecologie-obstetrique maieutique
Radiographie | radio, scanner, IRM, imagerie médicale | radiologie electroradiologie-medicale
Électrocardiogramme | ECG, bilan cardiaque | cardiologie medecine-generale
Bilan allergologique | tests allergiques, prick tests | allergologie
Examen de la vue | contrôle de la vue, fond d'œil, lunettes | ophtalmologie orthoptie optique-lunetterie
Bilan auditif | test auditif, audiogramme | orl audioprothese
Détartrage | nettoyage des dents, contrôle dentaire | dentaire parodontologie
Médecine du travail | visite médicale du travail, aptitude au poste | medecine-du-travail soins-infirmiers-en-sante-au-travail
Deuxième avis | second avis médical, autre avis | medecine-generale *medecine-generale-et-specialites-medicales *chirurgie
Téléconsultation | consultation à distance, visio | medecine-generale psychologie dietetique

## reason | Rééducation et récupération
Rééducation après opération | rééducation post-opératoire, après une chirurgie | kinesitherapie medecine-physique-et-de-readaptation physiotherapie
Rééducation après une blessure | reprise après blessure, retour au sport | kinesitherapie medecine-du-sport preparation-physique recuperation-sportive
Rééducation du périnée | rééducation périnéale, après accouchement, plancher pelvien | reeducation-perineale maieutique kinesitherapie
Rééducation respiratoire | kiné respiratoire, désencombrement | reeducation-respiratoire kinesitherapie
Prévention des chutes | équilibre, perte d'équilibre, chutes à répétition | kinesitherapie ergotherapie activite-physique-adaptee geriatrie
Bilan postural | posture, mauvaise posture, semelles orthopédiques | podologie podo-orthese osteopathie kinesitherapie
Semelles orthopédiques | orthèses plantaires, semelles sur mesure | podologie podo-orthese orthopedie-orthese
Aménagement du domicile | adapter son logement, aides techniques | ergotherapie adaptation-du-quotidien accessibilite
Appareillage | prothèse, orthèse, fauteuil roulant | orthoprothese orthopedie-orthese podo-orthese epithese

## reason | Grossesse, naissance et parentalité
Suivi de grossesse | grossesse, enceinte, consultation prénatale | maieutique gynecologie-obstetrique medecine-generale
Préparation à l'accouchement | préparation à la naissance, cours de préparation | maieutique accompagnement-a-la-naissance accompagnement-par-une-doula sophrologie
Projet de naissance | accouchement physiologique, naissance respectée | maieutique accompagnement-par-une-doula accompagnement-a-la-naissance
Post-partum | après l'accouchement, suites de couches, quatrième trimestre | maieutique accompagnement-postnatal accompagnement-par-une-doula retour-a-la-maison-apres-la-naissance
Baby blues | dépression post-partum, déprime après bébé | psychologie maieutique accompagnement-postnatal psychiatrie
Allaitement | allaiter, tire-lait, montée de lait, sevrage | allaitement lactation maieutique puericulture
Portage du bébé | écharpe de portage, porte-bébé | portage-physiologique
Désir d'enfant | projet bébé, préconception | fertilite gynecologie-medicale maieutique
PMA | procréation médicalement assistée, FIV, insémination | medecine-de-la-reproduction infertilite gynecologie-medicale
Suivi du nourrisson | bébé, nouveau-né, visite du nourrisson | pediatrie medecine-generale puericulture
Éducation des enfants | parentalité positive, éducation bienveillante, poser des limites | coaching-parental conseil-parental coaching-en-education accompagnement-en-parentalite
Relation avec un adolescent | crise d'adolescence, ado difficile | parents-d-adolescents psychologie-de-l-enfant-et-de-l-adolescent coaching-parental therapie-familiale
Séparation des parents | divorce, garde des enfants, coparentalité | mediation-familiale accompagnement-de-la-separation therapie-familiale conseil-conjugal-et-familial

## reason | Vie personnelle, couple et famille
Difficultés de couple | crise de couple, disputes, problèmes de couple | therapie-de-couple coaching-de-couple conseil-conjugal communication-de-couple
Infidélité | tromperie, trahison, adultère | therapie-de-couple conseil-conjugal coaching-de-couple
Séparation | rupture, divorce, chagrin d'amour | accompagnement-de-la-separation psychologie therapie-de-couple coaching-relationnel
Préparation au mariage | se marier, vie de couple | preparation-au-mariage conseil-conjugal coaching-de-couple
Conflits familiaux | tensions familiales, disputes en famille | conflits-familiaux mediation-familiale therapie-familiale
Famille recomposée | beaux-enfants, belle-famille | familles-recomposees therapie-familiale coaching-familial
Aidant familial | aider un proche, proche malade, épuisement de l'aidant | aidants-familiaux psychologie accompagnement-des-personnes-agees
Changement de vie | nouveau départ, transition, expatriation, retraite | changement-de-vie transitions-de-vie coaching-de-vie
Sens de la vie | trouver sa voie, quête de sens, épanouissement | coaching-de-vie developpement-personnel psychotherapie
Vie affective | rencontres amoureuses, relations amoureuses, célibat | relations-affectives coaching-relationnel vie-affective-et-sexuelle
Sexualité | vie sexuelle, épanouissement sexuel, questions sur la sexualité | sexologie sexotherapie sante-sexuelle vie-affective-et-sexuelle
Organisation du quotidien | gestion du temps, procrastination, s'organiser | organisation-personnelle gestion-du-temps habitudes-et-routines productivite
Procrastination | remettre à plus tard, manque de motivation | gestion-du-temps motivation coaching-de-vie therapie-cognitivo-comportementale-tcc
Prise de parole en public | parler en public, trac, oral | prise-de-parole communication
Prise de décision | faire un choix, indécision | prise-de-decision coaching-de-vie

## reason | Études et travail
Orientation scolaire | choisir sa filière, Parcoursup, choix d'études | orientation-scolaire conseil-en-orientation orientation coaching-etudiant
Préparation aux examens | révisions, bac, brevet, concours, partiels | preparation-aux-examens methodologie coaching-scolaire organisation-des-etudes
Stress des examens | trac des examens, angoisse avant les examens | stress-scolaire sophrologie gestion-du-stress preparation-aux-examens
Méthode de travail | apprendre à apprendre, méthodologie, mémoriser | methodologie strategies-d-apprentissage memorisation coaching-scolaire
Reconversion professionnelle | changer de métier, bilan de compétences, nouvelle carrière | reconversion-professionnelle coaching-de-carriere orientation-professionnelle
Recherche d'emploi | trouver un emploi, CV, lettre de motivation | recherche-d-emploi coaching-de-carriere entretien-d-embauche
Entretien d'embauche | préparer un entretien, recrutement | entretien-d-embauche recherche-d-emploi
Souffrance au travail | mal-être au travail, harcèlement au travail, conflit au travail | psychologie-du-travail medecine-du-travail psychologie prevention-du-surmenage-professionnel
Management | manager une équipe, posture de manager | management leadership coaching-de-dirigeants
Création d'entreprise | entreprendre, lancer son activité, freelance | creation-d-entreprise entrepreneuriat
Équilibre vie pro et vie perso | télétravail, déconnexion, équilibre de vie | equilibre-vie-professionnelle-vie-personnelle equilibre-de-vie

## reason | Forme, sport et bien-être
Remise en forme | reprendre le sport, retrouver la forme | remise-en-forme coaching-sportif fitness activite-physique-adaptee
Préparation sportive | performance, compétition, préparation physique | preparation-physique coaching-sportif medecine-du-sport nutrition-sportive
Course à pied | running, marathon, trail | course-a-pied coaching-sportif medecine-du-sport podologie
Renforcement musculaire | tonifier, gainage, musculation | renforcement-musculaire musculation pilates coaching-sportif
Souplesse | mobilité, étirements, assouplissements | souplesse mobilite stretching pilates
Sport adapté | sport santé, activité physique adaptée, sport sur ordonnance | activite-physique-adaptee education-a-l-activite-physique kinesitherapie
Récupération | récupération après l'effort, massage sportif | recuperation-sportive massage-sportif kinesitherapie
Détente | se relaxer, lâcher prise, moment pour soi | massage-relaxant massage-bien-etre relaxation-corporelle relaxologie sophrologie
Massage | massage bien-être, massage relaxant, modelage | massage-bien-etre massage-relaxant massage-sportif massage-cranien massage-du-visage massage-assis
Méditation | apprendre à méditer, méditation guidée | meditation pleine-conscience
Respiration | cohérence cardiaque, exercices de respiration | respiration-consciente sophrologie gestion-du-stress
Hygiène de vie | mode de vie sain, habitudes de santé | hygiene-de-vie naturopathie education-pour-la-sante prevention-sante
Immunité | défenses immunitaires, tomber souvent malade | naturopathie micronutrition medecine-generale
Premiers secours | gestes qui sauvent, formation PSC1, secourisme | premiers-secours
Esthétique médicale | injections, botox, acide hyaluronique, laser | dermatologie chirurgie-esthetique
Chirurgie esthétique | rhinoplastie, augmentation mammaire, liposuccion, lifting | chirurgie-esthetique chirurgie-plastique
Fin de vie | soins palliatifs, accompagnement de fin de vie | soins-palliatifs psychologie accompagnement-du-deuil

## approach | Psychothérapies et méthodes
Thérapie cognitivo-comportementale | TCC, cognitivo-comportemental | therapie-cognitivo-comportementale-tcc psychologie psychologie-clinique
EMDR | désensibilisation par mouvements oculaires | emdr psychologie therapie-des-traumatismes
Thérapie d'acceptation et d'engagement | ACT, flexibilité psychologique | therapie-d-acceptation-et-d-engagement-act psychologie
Thérapie comportementale dialectique | DBT | therapie-comportementale-dialectique-dbt psychologie
Thérapie des schémas | schémas précoces | therapie-des-schemas psychologie
Thérapie systémique | approche systémique, thérapie familiale systémique | therapie-systemique therapie-familiale
Thérapie brève | thérapie orientée solution, thérapie stratégique | psychotherapie psychologie
Psychanalyse | psychanalytique, approche analytique | psychotherapie psychologie-clinique psychiatrie
Approche humaniste | thérapie centrée sur la personne, Rogers, Gestalt | therapie-centree-sur-la-personne psychotherapie psychopratique
Hypnose | hypnose ericksonienne, hypnothérapie, autohypnose | psychotherapie psychologie sophrologie
Pleine conscience | mindfulness, MBSR, MBCT | pleine-conscience meditation psychologie
Analyse transactionnelle | AT | psychotherapie coaching-de-vie
Programmation neuro-linguistique | PNL | coaching-de-vie developpement-personnel
Communication non violente | CNV | communication communication-de-couple coaching-parental
Bilan neuropsychologique | tests cognitifs, bilan cognitif, test de QI | neuropsychologie psychologie-de-l-enfant-et-de-l-adolescent
Thérapie de groupe | groupe de parole, ateliers collectifs | psychologie psychotherapie ateliers-de-bien-etre

## approach | Approches corporelles et naturelles
Ostéopathie | ostéo, manipulations ostéopathiques | osteopathie
Ostéopathie pédiatrique | ostéopathe pour bébé, ostéo enfant | osteopathie
Chiropraxie | chiro, ajustements vertébraux | chiropraxie
Kinésithérapie | kiné, rééducation | kinesitherapie physiotherapie
Acupuncture | aiguilles, médecine chinoise | acupuncture
Auriculothérapie | acupuncture de l'oreille | auriculotherapie
Réflexologie | réflexologie plantaire, réflexologie palmaire, points réflexes | reflexologie reflexologie-plantaire reflexologie-palmaire reflexologie-faciale
Hijama | ventouses, cupping, saignée | hijama ventouses-seches ventouses-humides
Phytothérapie | plantes médicinales, tisanes, plantes | phytotherapie conseil-en-phytotherapie herboristerie naturopathie
Aromathérapie | huiles essentielles | aromatherapie conseil-en-aromatherapie
Micronutrition | compléments alimentaires, vitamines, minéraux | micronutrition conseil-en-micronutrition
Naturopathie | naturo, médecine naturelle | naturopathie conseil-en-naturopathie
Sophrologie | sophro, relaxation dynamique | sophrologie
Drainage lymphatique | drainage, rétention d'eau | drainage-bien-etre kinesitherapie
Pilates | méthode Pilates | pilates
Yoga | yoga doux, yoga thérapeutique | relaxation-corporelle pleine-conscience
Massage bébé | massage du nourrisson, toucher bébé | massage-bebe accompagnement-au-massage-bebe
Massage prénatal | massage femme enceinte | massage-prenatal
Méthode Feldenkrais | prise de conscience par le mouvement | mobilite psychomotricite
Éducation thérapeutique | apprendre à vivre avec sa maladie, ETP | education-therapeutique education-therapeutique-infirmiere
Médecine thermale | cure thermale, thermalisme | medecine-thermale

## approach | Modalités de consultation
Consultation à domicile | se déplace à domicile, visite à domicile | soins-infirmiers-a-domicile medecine-generale kinesitherapie
Consultation en visio | téléconsultation, en ligne, à distance | psychologie dietetique coaching-de-vie
Ateliers collectifs | séances de groupe, cours collectifs | ateliers-de-bien-etre *coaching-sportif-et-mouvement
Accompagnement en entreprise | interventions en entreprise, qualité de vie au travail, QVT | psychologie-du-travail coaching-professionnel prevention-sante ateliers-de-bien-etre

## audience | Publics accompagnés
Bébés | nourrissons, nouveau-nés | pediatrie osteopathie puericulture massage-bebe sommeil-du-bebe
Enfants | enfant, pédiatrique | pediatrie psychologie-de-l-enfant-et-de-l-adolescent orthophonie psychomotricite therapie-de-l-enfant pedodontie
Adolescents | ado, adolescent, jeunes | psychologie-de-l-enfant-et-de-l-adolescent pedopsychiatrie parents-d-adolescents coaching-scolaire
Étudiants | étudiant, vie étudiante | coaching-etudiant orientation-scolaire preparation-aux-examens
Femmes enceintes | grossesse, future maman | maieutique gynecologie-obstetrique massage-prenatal accompagnement-perinatal
Jeunes parents | nouveaux parents, futurs parents | accompagnement-a-la-parentalite accompagnement-postnatal coaching-parental
Seniors | personnes âgées, plus de 65 ans, retraités | geriatrie psychogerontologie accompagnement-des-personnes-agees dietetique-geriatrique soins-infirmiers-en-gerontologie
Sportifs | athlètes, sportifs de haut niveau | medecine-du-sport nutrition-sportive preparation-physique massage-sportif kinesitherapie
Couples | en couple, conjoints | therapie-de-couple coaching-de-couple conseil-conjugal sexologie
Familles | famille, parents et enfants | therapie-familiale coaching-familial mediation-familiale
Personnes en situation de handicap | handicap, PMR, handicap moteur, handicap mental | handicap ergotherapie accompagnement-a-l-autonomie education-specialisee activite-physique-adaptee
Aidants | proches aidants, aidant familial | aidants-familiaux
Salariés | actifs, cadres, employés | psychologie-du-travail coaching-professionnel prevention-du-surmenage-professionnel
Dirigeants | chefs d'entreprise, entrepreneurs, indépendants | coaching-de-dirigeants entrepreneuriat creation-d-entreprise
Personnes LGBT+ | LGBT, LGBTQIA+, homosexualité, transidentité | psychologie sexologie sante-sexuelle
Femmes | santé des femmes, praticienne pour femmes | gynecologie-medicale maieutique dietetique-et-sante-feminine
Hommes | santé des hommes, santé masculine | andrologie urologie
Expatriés | vivre à l'étranger, retour d'expatriation | psychologie coaching-de-vie transitions-de-vie
`;

const TYPES = ['symptom', 'reason', 'approach', 'audience'];

/** [{ name, synonyms, type, sensitive, targets: ['slug' | '*famille'] }] dans l'ordre de la liste */
const parseKeywords = () => {
	const keywords = [];
	let type = null;
	for (const raw of CATALOG.split('\n')) {
		const line = raw.trim();
		if (!line) continue;
		if (line.startsWith('## ')) {
			type = line.slice(3).split('|')[0].trim();
			if (!TYPES.includes(type)) throw new Error(`Type de mot-clé inconnu dans le catalogue : ${type}`);
			continue;
		}
		const [label, synonyms = '', targets = ''] = line.split('|').map((s) => s.trim());
		keywords.push({
			name: label.replace(/^!/, '').trim(),
			synonyms,
			type,
			sensitive: label.startsWith('!'),
			targets: targets.split(/\s+/).filter(Boolean),
		});
	}
	return keywords;
};

module.exports = { parseKeywords, TYPES };
