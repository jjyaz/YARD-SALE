import { createFileRoute } from "@tanstack/react-router";

import { Bullets, ContentBody, PageHeader, Section } from "@/components/site/ContentPage";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Use — YARD SALE" },
      {
        name: "description",
        content: "The terms that govern listing, buying and using YARD SALE. Draft, pending legal review.",
      },
      { property: "og:title", content: "Terms of Use — YARD SALE" },
      { property: "og:description", content: "Terms governing use of the YARD SALE marketplace." },
    ],
  }),
  component: Terms,
});

function Terms() {
  return (
    <>
      <PageHeader
        eyebrow="Legal"
        title="Terms of use"
        intro="Draft terms, version 0.1. These have not yet been reviewed by a qualified lawyer and must not be relied on as final. See the legal review checklist in the repository."
      />
      <ContentBody>
        <Section title="1. What YARD SALE is">
          <p>
            YARD SALE is a venue for listing second-hand physical items for local pickup. We are not
            a party to any sale, we do not take custody of items or funds, and we do not act as an
            agent, broker, auctioneer, escrow provider or financial institution.
          </p>
        </Section>
        <Section title="2. Eligibility">
          <Bullets
            items={[
              "You must be of legal age to form a binding contract in your jurisdiction.",
              "You must provide accurate account information and keep it current.",
              "You are responsible for everything done through your account.",
            ]}
          />
        </Section>
        <Section title="3. Your listings">
          <Bullets
            items={[
              "You must own the item, or have the right to sell it.",
              "Descriptions and photos must be honest, current and of the actual item.",
              "You must comply with the prohibited items policy and all applicable law.",
              "You are responsible for any tax arising from your sales.",
            ]}
          />
        </Section>
        <Section title="4. Transactions between users">
          <p>
            Sales happen between buyer and seller. You are responsible for inspecting the item,
            agreeing terms, meeting safely, and resolving any dispute. We may, but are not obliged
            to, assist.
          </p>
        </Section>
        <Section title="5. On-chain features">
          <Bullets
            items={[
              "On-chain features are optional and currently disabled in this build.",
              "Blockchain transactions are irreversible and outside our control.",
              "Item Passports record claims; they do not verify or guarantee anything.",
              "Companion tokens are novelties, not investments, securities or promises of value.",
            ]}
          />
        </Section>
        <Section title="6. Content and moderation">
          <p>
            You keep ownership of your content and grant us a licence to display it in connection
            with the service. We may remove listings, hide content or suspend accounts where we
            reasonably believe our policies or the law have been breached.
          </p>
        </Section>
        <Section title="7. No warranty">
          <p>
            The service is provided as-is and as-available. To the maximum extent permitted by law,
            we disclaim all warranties, including fitness for a particular purpose and any warranty
            about items listed by users.
          </p>
        </Section>
        <Section title="8. Limitation of liability">
          <p>
            To the maximum extent permitted by law, we are not liable for indirect, incidental or
            consequential loss, or for loss of funds, items or digital assets arising from your use
            of the service or of any blockchain network.
          </p>
        </Section>
        <Section title="9. Changes">
          <p>
            We may update these terms. Material changes will be published with a new version number
            and effective date, and listings record the terms version accepted at publication.
          </p>
        </Section>
        <Section title="10. Independence">
          <p>
            YARD SALE is independent and is not affiliated with, sponsored by, or endorsed by
            Robinhood Markets, Inc. or any of its subsidiaries.
          </p>
        </Section>
      </ContentBody>
    </>
  );
}
