# Pool Lab

## Présentation

Cette intégration amène dans Gladys les tests d’eau de votre photomètre **Water-i.d. PoolLab 1.0 / 2.0** ou **PrimeLab** : pH, chlore, acide cyanurique, alcalinité, dureté et les autres paramètres que vous mesurez, avec la plage idéale que vous avez définie pour chacun dans LabCom. Elle lit le **cloud LabCom** via son API GraphQL officielle, avec un jeton d’API personnel. Elle ne fait que lire et n’est pas affiliée à Water-i.d.

- Un appareil par « point de prélèvement » LabCom (une piscine, un spa) : une fonctionnalité par paramètre mesuré, avec la valeur de son dernier test, et l’équilibre de l’eau (ce qui sort de sa plage idéale).
- Deux widgets de tableau de bord : le dernier test d’un bassin, coloré selon la plage idéale ; l’historique d’un paramètre avec sa plage idéale.
- Déclencheurs de scène : nouvelle mesure, paramètre hors de sa plage idéale, retour dans la plage, test de l’eau en retard, jeton refusé.
- Actions de scène : actualiser maintenant, dernière valeur d’un paramètre.

Les mesures restent **manuelles** : vous testez l’eau avec le photomètre, l’application PoolLab synchronise le résultat avec LabCom, et Gladys le lit à cet endroit. Gladys ne fait jamais de mesure elle-même.

Transport : cloud. Le jeton d’API part vers LabCom (`backend.labcom.cloud`) ; les mesures viennent du cloud LabCom.

## Prérequis

- Gladys Assistant 5.3.0 ou plus récent.
- Un PoolLab 1.0, un PoolLab 2.0 ou un PrimeLab, et un compte LabCom sur lequel l’application synchronise ses mesures (vérifiez-les sur [labcom.cloud](https://labcom.cloud/)).
- Un **jeton d’API** personnel : connectez-vous à [labcom.cloud](https://labcom.cloud/), ouvrez **Paramètres** ([labcom.cloud/pages/user-setting](https://labcom.cloud/pages/user-setting)), créez un jeton d’API et copiez-le. Gardez-le secret : quiconque le détient peut lire vos mesures.
- Facultatif mais utile : la plage idéale de chaque paramètre dans LabCom (valeurs basse et haute). Sans elle, un paramètre est affiché « sans plage idéale » et ne déclenche jamais les déclencheurs de plage.

## Configuration

| Champ                | Rôle                                                                                                                             |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Jeton d’API LabCom   | Le jeton créé sur labcom.cloud (un secret : jamais réaffiché, jamais écrit dans les journaux ; seule une empreinte dans `/data`) |
| Lecture de LabCom    | Toutes les 5, 10, 15 (par défaut), 30 ou 60 minutes : le délai après une synchronisation avant que Gladys voie un nouveau test   |
| Rappel de test après | 3, 7 (par défaut), 14 ou 30 jours sans nouvelle mesure avant le déclencheur « test de l’eau en retard » ; ou jamais              |
| Langue des textes    | Noms des fonctionnalités, équilibre de l’eau, textes des scènes et erreurs ; automatique suit le dernier widget                  |

Boutons :

- **Tester la connexion** lit LabCom avec le jeton et liste les bassins (et combien ont des mesures).
- **Diagnostic** écrit l’état de l’intégration dans ses journaux, sans le jeton.

La première lecture récupère toutes les mesures du compte ; ensuite chaque lecture ne demande que les mesures de la dernière semaine, et les 400 derniers jours sont relus toutes les 6 heures (une mesure modifiée ou supprimée dans LabCom est suivie). L’intégration garde jusqu’à 300 mesures sur 400 jours par paramètre dans `/data`.

## Utilisation

### Appareils

Après la configuration, ouvrez **Découvrir** : chaque piscine ou spa ayant au moins une mesure est proposé comme appareil, nommé d’après sa référence dans LabCom. Ajoutez ceux que vous voulez. Un paramètre mesuré plus tard ajoute une fonctionnalité : la découverte propose alors de mettre à jour l’appareil.

| Paramètre                                                                                                                                            | Catégorie / type                 | Unité                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | --------------------------- |
| pH                                                                                                                                                   | `ph-sensor` / `decimal`          | pH                          |
| Chlore libre, total, combiné, brome, oxygène actif, peroxyde d’hydrogène, dioxyde de chlore, ozone, PHMB, acide cyanurique, alcalinité, dureté, sel… | `level-sensor` / `decimal`       | ppm (mg/l), ou aucune       |
| Température de l’eau                                                                                                                                 | `temperature-sensor` / `decimal` | °C (°F si LabCom l’indique) |
| Redox (ORP)                                                                                                                                          | `orp-sensor` / `decimal`         | mV                          |
| Équilibre de l’eau                                                                                                                                   | `text` / `text`                  | —                           |

Gladys n’a pas de catégorie pour le chlore ou l’alcalinité : ils utilisent le capteur numérique simple `level-sensor` / `decimal` (comme l’intégration Flipr). Une valeur hors de l’échelle de mesure du photomètre (OVERRANGE, UNDERRANGE) n’a pas de nombre : la fonctionnalité garde sa dernière valeur, l’équilibre de l’eau et les widgets l’indiquent.

### Widgets du tableau de bord

![Les deux widgets : le dernier test d’une piscine (pH et chlore libre hors plage, les autres dans la plage) et l’historique sur 90 jours de son chlore libre avec la plage idéale, puis le dernier test d’un spa (illustration générée, pas une capture d’écran)](https://raw.githubusercontent.com/William-De71/gladys-pool-lab/main/docs/assets/widgets.fr.png)

- **Test de l’eau** : un bassin (à choisir dans les réglages du widget ; le premier par défaut) : les cinq premiers paramètres en tuiles, vert dans la plage, orange hors plage, rouge hors de l’échelle de mesure, gris sans plage ; la date du dernier test, l’équilibre de l’eau et les autres paramètres. Le bouton **Actualiser** lit LabCom tout de suite (une fois par minute au plus).
- **Historique d’un paramètre** : un paramètre d’un bassin sur 30, 90 ou 365 jours, à l’heure réelle de chaque test (pas l’heure où Gladys l’a reçu), avec l’idéal bas et l’idéal haut en deux lignes, le nombre de tests et la part dans la plage.

### Scènes

Déclencheurs (une fois par changement, jamais à la première lecture, jamais à cause d’une action de scène), filtrables par bassin et par paramètre :

- **Nouvelle mesure** : un paramètre a un test plus récent dans LabCom (un événement par paramètre testé).
- **Paramètre hors plage** : un paramètre passe trop bas ou trop haut par rapport à sa plage idéale (filtre : sens).
- **Retour dans la plage** : un paramètre qui était hors plage y revient.
- **Test de l’eau en retard** : aucune mesure sur un bassin depuis le délai de la configuration, une fois, entre 9 h et 21 h.
- **Jeton refusé** : LabCom refuse le jeton d’API.

Actions :

- **Actualiser maintenant** : lit LabCom (une fois par minute au plus) ; renvoie le nombre de bassins, de paramètres hors plage et l’heure du dernier test.
- **Dernière valeur d’un paramètre** : valeur, unité, état, plage idéale, date et une phrase, d’après la dernière lecture.

Exemples :

- Quand **Pool Lab : paramètre hors plage** (chlore libre, trop bas) → envoyer « Chlore libre {{triggerEvent.data.value_text}} mg/l, idéal à partir de {{triggerEvent.data.ideal_low}} : ajoutez du chlore ».
- Quand **Pool Lab : test de l’eau en retard** → envoyer « Pas de test de la piscine depuis {{triggerEvent.data.days_since}} jours ».
- Chaque samedi à 10 h → **Pool Lab : dernière valeur d’un paramètre** (pH) → envoyer son résumé.

## Dépannage

- **« LabCom refuse le jeton d’API »** : le jeton a été supprimé ou mal copié ; créez-en un nouveau sur labcom.cloud (Paramètres) et collez-le dans la configuration.
- **Aucun appareil proposé** : seuls les bassins ayant au moins une mesure sont proposés ; appuyez sur **Tester la connexion** et vérifiez sur labcom.cloud que l’application a bien synchronisé.
- **Un test qui n’apparaît pas** : l’application doit d’abord le synchroniser avec LabCom ; il apparaît ensuite à la lecture suivante (15 minutes par défaut) ou avec **Actualiser**.
- **« Sans plage idéale »** : définissez l’idéal bas et l’idéal haut du paramètre dans LabCom.
- Pour un ticket, donnez les versions de Gladys et de l’intégration, le message de **Tester la connexion** et les lignes « Pool Lab diagnostic » écrites par **Diagnostic** dans les journaux de l’intégration. Ne collez jamais votre jeton.

### Limites connues

- **Jamais testée avec un vrai compte LabCom** : l’intégration suit le schéma GraphQL publié et les deux clients open source (Home Assistant, ioBroker). L’orthographe exacte de l’état de plage idéale est inconnue : il est lu sous toutes ses formes et calculé à partir de la plage idéale quand il manque.
- Les points de prélèvement partagés (par un autre utilisateur LabCom) et les produits de traitement ne sont pas lus.
- La nature d’un paramètre (pH, chlore libre…) vient de son identifiant ou de son nom LabCom : un paramètre inconnu garde son nom LabCom et la catégorie numérique simple.
