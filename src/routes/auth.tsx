import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { defaultChain } from "@/lib/chain";
import { requestSignInNonce, verifyWalletSignIn } from "@/lib/wallet-auth.functions";
import { shortAddress } from "@/lib/listing-meta";

type AuthSearch = { redirect?: string | undefined };

export const Route = createFileRoute("/auth")({
  validateSearch: (search: Record<string, unknown>): AuthSearch => ({
    redirect: typeof search["redirect"] === "string" ? search["redirect"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Sign in with your wallet — YARD SALE" },
      {
        name: "description",
        content:
          "Sign in to YARD SALE by signing a free message with your EVM wallet on Robinhood Chain. No email, no password.",
      },
      { property: "og:title", content: "Sign in with your wallet — YARD SALE" },
      {
        property: "og:description",
        content: "Wallet sign-in for YARD SALE on Robinhood Chain.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

type Eip1193 = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

function injectedProvider(): Eip1193 | null {
  return (globalThis as unknown as { ethereum?: Eip1193 }).ethereum ?? null;
}

function safePath(value: string | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  return value;
}

function AuthPage() {
  const { redirect } = Route.useSearch();
  const navigate = useNavigate();
  const { user, loading } = useSession();
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);

  const destination = safePath(redirect);

  useEffect(() => {
    if (!loading && user) {
      navigate({ to: destination, replace: true });
    }
  }, [loading, user, destination, navigate]);

  async function signInWithWallet() {
    const provider = injectedProvider();
    if (!provider) {
      toast.error("No browser wallet found. Install an EVM wallet extension and try again.");
      return;
    }
    setBusy(true);
    try {
      setStep("Waiting for your wallet…");
      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      const address = accounts[0];
      if (!address) throw new Error("No account was shared by the wallet.");

      setStep(`Requesting a challenge for ${shortAddress(address)}…`);
      const { message, nonce } = await requestSignInNonce({
        data: { address, chainId: defaultChain.id },
      });

      setStep("Sign the message in your wallet.");
      const signature = (await provider.request({
        method: "personal_sign",
        params: [message, address],
      })) as string;

      setStep("Verifying your signature…");
      const { tokenHash } = await verifyWalletSignIn({
        data: { address, chainId: defaultChain.id, nonce, message, signature },
      });

      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "email" });
      if (error) throw new Error(error.message);

      toast.success("Signed in with your wallet.");
      navigate({ to: destination, replace: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Wallet sign-in failed.");
    } finally {
      setStep(null);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col px-4 py-16 sm:px-6">
      <h1 className="text-3xl font-extrabold">Sign in with your wallet</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        YARD SALE uses your EVM wallet on {defaultChain.name} as your account. No email, no
        password — just one free signature.
      </p>

      <div className="mt-8 rounded-xl border border-border bg-card p-6">
        <Button className="w-full" disabled={busy} onClick={() => void signInWithWallet()}>
          {busy ? "Waiting for wallet…" : "Connect wallet & sign in"}
        </Button>
        {step ? <p className="mt-3 text-xs text-muted-foreground">{step}</p> : null}

        <ul className="mt-6 space-y-2 text-xs text-muted-foreground">
          <li>Signing costs nothing and sends no transaction.</li>
          <li>It grants no spending permission over your funds.</li>
          <li>We never ask for a seed phrase or private key.</li>
          <li>First sign-in creates your yard automatically.</li>
        </ul>
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        No wallet yet? Install an EVM browser wallet, then add {defaultChain.name} (chain ID{" "}
        {defaultChain.id}) and come back here.
      </p>
    </div>
  );
}
