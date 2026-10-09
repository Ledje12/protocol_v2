import Footer from "./Footer.jsx";
import ScreenHeader from "./ScreenHeader.jsx";

export default function PrivacyScreen({
    navigate,
  }) {
    return (
      <main className="app protocol-legal-page">

        <section className="protocol-legal-shell">

          <ScreenHeader
            onBack={() => {
              if (
                window.history.length > 1
              ) {
                window.history.back();
              } else {
                navigate("/");
              }
            }}
            subtitle="Informations légales"
          />

          <header className="protocol-legal-header">

            <span className="settings-card-eyebrow">
              CONFIDENTIALITÉ
            </span>

            <h1>
              Politique de confidentialité
            </h1>

            <p>
              Dernière mise à jour :
              24 septembre 2026
            </p>

          </header>


          <section className="protocol-legal-brief">
            <span className="settings-card-eyebrow">
              EN BREF
            </span>

            <ul>
              <li>
                <strong>Notifications discrètes.</strong>{" "}
                Le contenu sensible des cartes n’est jamais affiché dans les notifications.
              </li>

              <li>
                <strong>Session privée.</strong>{" "}
                L’accès à une partie repose sur un identifiant propre à chaque appareil.
              </li>

              <li>
                <strong>Contrôle local.</strong>{" "}
                Tu peux oublier la partie mémorisée sur un appareil à tout moment, depuis les réglages.
              </li>
            </ul>
          </section>

          <section className="protocol-legal-section">

            <h2>
              1. Responsable du traitement
            </h2>

            <p>
              PROTOCOL est édité par
              Jérôme LEJEUNE.
            </p>

            <p>
              Contact :
              protocol.auth@gmail.com.
            </p>

          </section>


          <section className="protocol-legal-section">

            <h2>
              2. Données traitées
            </h2>

            <p>
              PROTOCOL traite uniquement les
              données nécessaires au fonctionnement
              du service, notamment :
            </p>

            <ul>
              <li>
                l’adresse email utilisée pour
                l’authentification ;
              </li>

              <li>
                le prénom ou pseudonyme et le sexe
                renseignés dans le profil ;
              </li>

              <li>
                les informations permettant de relier
                deux utilisateurs au sein d’un couple ;
              </li>

              <li>
                les réponses de calibration et les
                paramètres de jeu ;
              </li>

              <li>
                l’historique des parties et des cartes
                utilisées ;
              </li>

              <li>
                les invitations, messages et signaux
                échangés dans PROTOCOL ;
              </li>

              <li>
                les informations techniques nécessaires
                aux notifications push ;
              </li>

              <li>
                lorsque cette fonction est utilisée,
                les informations techniques nécessaires
                à la connexion Lovense.
              </li>
            </ul>

          </section>


          <section className="protocol-legal-section">

            <h2>
              3. Finalités
            </h2>

            <p>
              Ces données sont utilisées pour :
            </p>

            <ul>
              <li>
                authentifier l’utilisateur ;
              </li>

              <li>
                mémoriser son profil ;
              </li>

              <li>
                créer et gérer le couple PROTOCOL ;
              </li>

              <li>
                adapter le déroulement des parties aux
                préférences communes ;
              </li>

              <li>
                synchroniser les parties entre les deux
                partenaires ;
              </li>

              <li>
                permettre les invitations, messages,
                notifications et fonctionnalités
                connectées demandées par l’utilisateur ;
              </li>

              <li>
                assurer la sécurité et le bon
                fonctionnement du service.
              </li>
            </ul>

          </section>


          <section className="protocol-legal-section">

            <h2>
              4. Base juridique
            </h2>

            <p>
              Les traitements nécessaires au
              fonctionnement de PROTOCOL sont réalisés
              afin de fournir le service demandé par
              l’utilisateur.
            </p>

            <p>
              Les fonctionnalités optionnelles nécessitant
              une autorisation de l’utilisateur, comme les
              notifications ou certaines intégrations,
              ne sont activées qu’à sa demande.
            </p>

          </section>


          <section className="protocol-legal-section">

            <h2>
              5. Destinataires et prestataires
            </h2>

            <p>
              Les données ne sont pas vendues.
            </p>

            <p>
              Elles peuvent être traitées par les
              prestataires techniques nécessaires au
              fonctionnement de PROTOCOL, notamment
              l’infrastructure d’hébergement, de base de
              données, d’authentification et de
              déploiement de l’application.
            </p>

            <p>
              Les intégrations externes optionnelles,
              notamment Lovense, ne sont utilisées que
              lorsque l’utilisateur choisit de les
              activer.
            </p>

          </section>


          <section className="protocol-legal-section">

            <h2>
              6. Conservation
            </h2>

            <p>
              Les données liées au compte sont conservées
              tant que le compte PROTOCOL reste actif,
              sauf lorsqu’une durée différente est
              nécessaire pour assurer le fonctionnement
              ou la sécurité du service.
            </p>

            <p>
              Lorsqu’un utilisateur supprime son compte,
              son profil est supprimé. S’il appartient à
              un couple PROTOCOL, les données communes du
              couple et les parties associées sont
              également supprimées.
            </p>

            <p>
              Le compte du partenaire n’est pas supprimé.
            </p>

          </section>


          <section className="protocol-legal-section">

            <h2>
              7. Données stockées sur l’appareil
            </h2>

            <p>
              PROTOCOL utilise le stockage local du
              navigateur pour conserver certaines
              informations nécessaires à la session et
              permettre notamment de reprendre une partie.
            </p>

            <p>
              Ces données peuvent être effacées depuis
              les réglages ou lors de la suppression du
              compte.
            </p>

          </section>


          <section className="protocol-legal-section">

            <h2>
              8. Vos droits
            </h2>

            <p>
              Selon le RGPD, vous pouvez notamment
              demander l’accès, la rectification,
              l’effacement ou, lorsque les conditions
              sont réunies, la limitation ou la
              portabilité de vos données.
            </p>

            <p>
              Vous pouvez également supprimer directement
              votre compte depuis les réglages de
              PROTOCOL.
            </p>

            <p>
              Pour exercer vos autres droits :
              protocol.auth@gmail.com.
            </p>

          </section>


          <section className="protocol-legal-section">

            <h2>
              9. Réclamation
            </h2>

            <p>
              Si vous estimez que le traitement de vos
              données personnelles ne respecte pas la
              réglementation applicable, vous pouvez
              introduire une réclamation auprès de
              l’autorité de protection des données
              compétente.
            </p>

          </section>


          <section className="protocol-legal-section">

            <h2>
              10. Sécurité et confidentialité
            </h2>

            <p>
              PROTOCOL met en œuvre des mesures destinées
              à limiter l’accès aux données aux
              utilisateurs concernés et aux services
              techniques qui en ont besoin pour
              fonctionner.
            </p>

            <p>
              Le contenu sensible des cartes n’est pas
              repris dans les notifications envoyées par
              l’application.
            </p>

          </section>


          <Footer />

        </section>

      </main>
    );
  }
