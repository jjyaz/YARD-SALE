import { createFileRoute } from "@tanstack/react-router";

import { Bullets, ContentBody, PageHeader, Section } from "@/components/site/ContentPage";

export const Route = createFileRoute("/how-it-works")({
  head: () => ({
    meta: [
      { title: "How YARD SALE Works — Listing, Pickup, Item Passports" },
      {
        name: "description",
        content:
          "Photograph the thing, price it, meet in person. Optional Item Passports record the item's history on Robinhood Chain.",
      },
      { property: "og:title", content: "How YARD SALE Works" },
      {
        property: "og:description",
        content: "Local second-hand selling with an optional on-chain record of the item.",
      },
    ],
  }),
  component: HowItWorks,
});

function HowItWorks() {
  return (
    <>
      <PageHeader
        eyebrow="How it works"
        title="Sell the thing. Keep the story."
        intro="YARD SALE is a plain second-hand marketplace first. Everything on-chain is optional, and nothing on this site takes custody of your item or your money."
      />
      <ContentBody>
        <Section title="For sellers">
          <Bullets
            items={[
              "Photograph the item honestly, including the scratches. Photos are required.",
              "Describe condition, dimensions and anything a buyer would want to ask about.",
              "Set a price in ETH, or list it free. Approximate dollar figures shown on the site are estimates only.",
              "Choose local pickup and give a general area — the exact address stays private until you share it.",
              "Publish. You can edit or unpublish at any time before an item is picked up.",
            ]}
          />
        </Section>
        <Section title="For buyers">
          <Bullets
            items={[
              "Browse or search by category, condition, price and area.",
              "Read the full description and look at every photo before you commit.",
              "Message the seller and agree on a public, well-lit meeting place.",
              "Inspect the item in person. You are buying a used physical object, as-is.",
            ]}
          />
        </Section>
        <Section title="What an Item Passport is">
          <p>
            An Item Passport is an optional on-chain record for a physical thing: what it is, who
            listed it, and when it changed hands. It is a receipt and a history, not a claim about
            what the item is worth.
          </p>
          <Bullets
            items={[
              "A passport does not authenticate, appraise or insure your item.",
              "A passport does not transfer ownership by itself — the handover happens in person.",
              "Nothing on this site is investment advice, and companion tokens are not securities offerings.",
            ]}
          />
        </Section>
        <Section title="What is switched off right now">
          <p>
            Minting, companion tokens, escrow and liquidity locking are disabled in this build. They
            stay disabled until the contracts are deployed, independently audited, and the legal
            review checklist is complete. The status page lists exactly what is configured.
          </p>
        </Section>
      </ContentBody>
    </>
  );
}
