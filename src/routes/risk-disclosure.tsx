import { createFileRoute } from "@tanstack/react-router";

import { Bullets, ContentBody, PageHeader, Section } from "@/components/site/ContentPage";

export const Route = createFileRoute("/risk-disclosure")({
  head: () => ({
    meta: [
      { title: "Risk Disclosure — YARD SALE" },
      {
        name: "description",
        content:
          "Plain-language risks of using an unaudited on-chain marketplace: contracts, tokens, volatility and irreversibility.",
      },
      { property: "og:title", content: "Risk Disclosure — YARD SALE" },
      {
        property: "og:description",
        content: "The risks of unaudited contracts, companion tokens and on-chain transactions.",
      },
    ],
  }),
  component: RiskDisclosure,
});

function RiskDisclosure() {
  return (
    <>
      <PageHeader
        eyebrow="Risk"
        title="Read this before you connect anything"
        intro="YARD SALE is experimental software. This page describes real risks in plain language. Nothing here is financial, legal or tax advice."
      />
      <ContentBody>
        <Section title="Unaudited software">
          <p>
            The smart contracts in this project have not completed an independent security audit.
            Unaudited contracts can contain bugs that permanently lock or lose funds. This is why
            all on-chain write actions are disabled in this build.
          </p>
        </Section>
        <Section title="Transactions are final">
          <Bullets
            items={[
              "On-chain transactions cannot be reversed, cancelled or refunded by us.",
              "Sending to a wrong address means the funds are gone.",
              "Network fees are charged whether or not a transaction succeeds.",
            ]}
          />
        </Section>
        <Section title="Companion tokens">
          <Bullets
            items={[
              "A companion token is a novelty record tied to a listing. It is not an investment.",
              "There is no promise of a market, a price, liquidity, or any future value.",
              "Thin or locked liquidity means you may be unable to sell at any price.",
              "Token prices can go to zero. Assume they will.",
            ]}
          />
        </Section>
        <Section title="Item Passports do not guarantee the item">
          <p>
            A passport records claims made by a seller. It does not verify authenticity, condition,
            provenance or legal ownership. The physical item is still bought as-is, in person.
          </p>
        </Section>
        <Section title="Volatility and estimates">
          <p>
            Prices shown in dollars are rough estimates using a fixed reference rate. The real value
            of ETH moves constantly. Treat every fiat figure on this site as illustrative only.
          </p>
        </Section>
        <Section title="Your keys, your responsibility">
          <Bullets
            items={[
              "Lose your wallet's recovery phrase and nobody can restore access.",
              "Approve a malicious signature and you may lose assets held by that wallet.",
              "We never ask for private keys or seed phrases, and never will.",
            ]}
          />
        </Section>
      </ContentBody>
    </>
  );
}
