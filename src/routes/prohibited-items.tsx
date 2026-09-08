import { createFileRoute } from "@tanstack/react-router";

import { Bullets, ContentBody, PageHeader, Section } from "@/components/site/ContentPage";

export const Route = createFileRoute("/prohibited-items")({
  head: () => ({
    meta: [
      { title: "Prohibited Items — YARD SALE" },
      {
        name: "description",
        content: "Things that may never be listed on YARD SALE, and what happens if they are.",
      },
      { property: "og:title", content: "Prohibited Items — YARD SALE" },
      { property: "og:description", content: "What may never be listed on YARD SALE." },
    ],
  }),
  component: Prohibited,
});

function Prohibited() {
  return (
    <>
      <PageHeader
        eyebrow="Policy"
        title="Prohibited items"
        intro="This list is not exhaustive. If you are unsure whether something belongs here, assume it does not."
      />
      <ContentBody>
        <Section title="Never allowed">
          <Bullets
            items={[
              "Weapons, ammunition, explosives and their components.",
              "Drugs, controlled substances, and drug paraphernalia.",
              "Prescription medicines, medical devices requiring a licence, and supplements making health claims.",
              "Live animals and any part of a protected or endangered species.",
              "Stolen property, or anything you cannot prove you have the right to sell.",
              "Counterfeit goods, replicas sold as genuine, and pirated media.",
              "Recalled products and items with removed or altered safety labels.",
              "Hazardous materials, including fuels, asbestos and unsealed batteries with damage.",
              "Personal data, account credentials, identity documents and government-issued IDs.",
              "Adult content, and anything sexualising minors.",
              "Human remains, bodily fluids and used cosmetics or underwear.",
              "Financial instruments, securities, and anything marketed as an investment return.",
            ]}
          />
        </Section>
        <Section title="Needs care">
          <Bullets
            items={[
              "Electrical goods must be described honestly, including whether they have been tested.",
              "Children's items must meet current safety standards and must not be recalled.",
              "Branded goods must be genuine and described with any flaws or repairs.",
            ]}
          />
        </Section>
        <Section title="Enforcement">
          <p>
            Prohibited listings are removed. Depending on severity, the account may be suspended and
            the matter referred to the relevant authority. Removals are recorded with a reason.
          </p>
        </Section>
      </ContentBody>
    </>
  );
}
