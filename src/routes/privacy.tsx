import { createFileRoute } from "@tanstack/react-router";

import { Bullets, ContentBody, PageHeader, Section } from "@/components/site/ContentPage";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — YARD SALE" },
      {
        name: "description",
        content: "What YARD SALE collects, what stays private, what is public on-chain, and your choices.",
      },
      { property: "og:title", content: "Privacy Policy — YARD SALE" },
      { property: "og:description", content: "How YARD SALE handles your data and pickup details." },
    ],
  }),
  component: Privacy,
});

function Privacy() {
  return (
    <>
      <PageHeader
        eyebrow="Legal"
        title="Privacy policy"
        intro="Draft policy, version 0.1, pending legal review. It describes the behaviour actually implemented in this build."
      />
      <ContentBody>
        <Section title="What we collect">
          <Bullets
            items={[
              "Account data: email address and a generated handle, plus anything you add to your profile.",
              "Listing data: titles, descriptions, photos, prices and the general area you choose to show.",
              "Private pickup data: exact address, access instructions and contact notes, stored separately.",
              "Wallet data: a wallet address you choose to link, and the time it was verified.",
              "Operational data: reports you file and moderation actions taken on your listings.",
            ]}
          />
        </Section>
        <Section title="What is public">
          <Bullets
            items={[
              "Published listings, their photos, and the general area — city, region and at most a partial postcode.",
              "Your handle, display name, bio and public listing counts.",
              "Nothing else is shown publicly by default.",
            ]}
          />
        </Section>
        <Section title="What stays private">
          <p>
            Exact addresses, access instructions and contact notes are stored in a separate table
            that only you can read. They are never included in public listing data and are never
            written on-chain.
          </p>
        </Section>
        <Section title="Blockchain data is permanent">
          <p>
            Anything recorded on a public blockchain cannot be edited or deleted by us or by you. We
            deliberately keep personal data off-chain. Do not put personal information into a field
            that will be published on-chain.
          </p>
        </Section>
        <Section title="Cookies and analytics">
          <p>
            We use the storage needed to keep you signed in. We do not run advertising trackers.
          </p>
        </Section>
        <Section title="Your choices">
          <Bullets
            items={[
              "Edit or delete your listings and profile details at any time.",
              "Unlink a wallet from settings; the address binding is removed.",
              "Request account deletion by contacting us; off-chain data is removed, on-chain records cannot be.",
            ]}
          />
        </Section>
      </ContentBody>
    </>
  );
}
