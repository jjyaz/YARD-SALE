import { createFileRoute } from "@tanstack/react-router";

import { Bullets, ContentBody, PageHeader, Section } from "@/components/site/ContentPage";

export const Route = createFileRoute("/trust-safety")({
  head: () => ({
    meta: [
      { title: "Trust & Safety — YARD SALE" },
      {
        name: "description",
        content:
          "How to meet safely, what we keep private, how reporting works, and the limits of what YARD SALE can guarantee.",
      },
      { property: "og:title", content: "Trust & Safety — YARD SALE" },
      {
        property: "og:description",
        content: "Meeting safely, private pickup details, reporting and moderation on YARD SALE.",
      },
    ],
  }),
  component: TrustSafety,
});

function TrustSafety() {
  return (
    <>
      <PageHeader
        eyebrow="Trust & safety"
        title="Meet in daylight. Bring a friend."
        intro="YARD SALE hosts listings between neighbours. We do not inspect items, verify claims, or take custody of anything. Here is what we do, and what you have to do yourself."
      />
      <ContentBody>
        <Section title="Meeting safely">
          <Bullets
            items={[
              "Meet in a public, well-lit place. Many police stations have designated exchange zones.",
              "Bring someone with you, especially for large or valuable items.",
              "Inspect the item fully before any payment changes hands.",
              "Trust your instincts. If a conversation feels off, walk away and report it.",
            ]}
          />
        </Section>
        <Section title="What stays private">
          <Bullets
            items={[
              "Exact pickup addresses, access notes and contact phone numbers are never shown publicly.",
              "Listings display only a general area — city, region, and at most a partial postcode.",
              "Private pickup details are readable only by the seller until they choose to share them.",
            ]}
          />
        </Section>
        <Section title="Reporting and moderation">
          <p>
            Every listing has a report control. Reports go to a human moderation queue where a
            listing can be hidden or removed. We record the reason and the action taken.
          </p>
          <Bullets
            items={[
              "Report anything unsafe, misleading, stolen, counterfeit or prohibited.",
              "Repeat violations lead to account suspension.",
              "We may remove a listing without warning if it creates a safety risk.",
            ]}
          />
        </Section>
        <Section title="Wallet safety">
          <Bullets
            items={[
              "YARD SALE never asks for your seed phrase or private key. Nobody legitimate ever will.",
              "Linking a wallet only proves you control the address — it grants no spending permission.",
              "Read every signature request before approving it, and check the domain shown.",
            ]}
          />
        </Section>
        <Section title="The limits of this platform">
          <p>
            YARD SALE is an unaudited beta. We do not escrow funds, guarantee items, verify
            identity, or resolve disputes. Transactions happen between you and the other person.
          </p>
        </Section>
      </ContentBody>
    </>
  );
}
