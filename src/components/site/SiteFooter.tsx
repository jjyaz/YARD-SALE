import { Link } from "@tanstack/react-router";

const columns = [
  {
    title: "Marketplace",
    links: [
      { to: "/browse", label: "Browse the yard" },
      { to: "/sell/new", label: "List an item" },
      { to: "/how-it-works", label: "How it works" },
    ],
  },
  {
    title: "Trust",
    links: [
      { to: "/trust-safety", label: "Trust & Safety" },
      { to: "/prohibited-items", label: "Prohibited items" },
      { to: "/risk-disclosure", label: "Risk disclosure" },
      { to: "/status", label: "Service status" },
    ],
  },
  {
    title: "Legal",
    links: [
      { to: "/terms", label: "Terms" },
      { to: "/privacy", label: "Privacy" },
    ],
  },
] as const;

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-border bg-card">
      <div className="mx-auto grid max-w-[1440px] gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_repeat(3,1fr)] lg:px-10">
        <div>
          <p className="text-lg font-extrabold tracking-tight">YARD SALE</p>
          <p className="mt-3 max-w-xs text-sm text-muted-foreground">
            Your Junk Deserves To Be On-Chain. Local pickup, verifiable history, and a wallet you
            control.
          </p>
        </div>
        {columns.map((column) => (
          <div key={column.title}>
            <h2 className="text-sm font-bold">{column.title}</h2>
            <ul className="mt-4 space-y-2">
              {column.links.map((link) => (
                <li key={link.to}>
                  <Link
                    to={link.to}
                    className="text-sm text-muted-foreground transition-colors duration-200 hover:text-foreground"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-border">
        <p className="mx-auto max-w-[1440px] px-4 py-6 text-xs text-muted-foreground sm:px-6 lg:px-10">
          YARD SALE is an independent application built on Robinhood Chain. It is not affiliated
          with or endorsed by Robinhood Markets, Inc. Unaudited beta — mainnet actions stay disabled
          until an independent contract audit and legal review are recorded.
        </p>
      </div>
    </footer>
  );
}
