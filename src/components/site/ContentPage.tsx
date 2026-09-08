import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  intro,
}: {
  eyebrow?: string;
  title: string;
  intro?: string;
}) {
  return (
    <header className="mx-auto max-w-[1440px] px-4 pb-8 pt-10 sm:px-6 lg:px-10">
      {eyebrow ? (
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-grass-deep">{eyebrow}</p>
      ) : null}
      <h1 className="mt-3 text-3xl font-extrabold sm:text-4xl">{title}</h1>
      {intro ? <p className="prose-measure mt-4 text-base text-muted-foreground">{intro}</p> : null}
    </header>
  );
}

export function ContentBody({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-[1440px] px-4 pb-16 sm:px-6 lg:px-10">
      <div className="prose-measure space-y-6 rounded-xl border border-border bg-card p-6 text-[15px] leading-relaxed sm:p-10">
        {children}
      </div>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-bold">{title}</h2>
      <div className="space-y-3 text-muted-foreground">{children}</div>
    </section>
  );
}

export function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-2 pl-5">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}
