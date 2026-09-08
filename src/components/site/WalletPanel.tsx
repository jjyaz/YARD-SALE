import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useSession } from "@/hooks/useSession";
import { supabase } from "@/integrations/supabase/client";
import { defaultChain, explorerAddressUrl } from "@/lib/chain";
import { shortAddress } from "@/lib/listing-meta";
import { requestWalletNonce, unlinkWallet, verifyWalletSignature } from "@/lib/wallet.functions";

type Eip1193 = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

function injectedProvider(): Eip1193 | null {
  const eth = (globalThis as unknown as { ethereum?: Eip1193 }).ethereum;
  return eth ?? null;
}

export function WalletPanel() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const wallets = useQuery({
    queryKey: ["my-wallets", user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wallets")
        .select("id, address, chain_id, verified_at")
        .eq("user_id", user!.id);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  async function link() {
    const provider = injectedProvider();
    if (!provider) {
      toast.error("No browser wallet found. Install a wallet extension and try again.");
      return;
    }
    setBusy(true);
    try {
      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      const address = accounts[0];
      if (!address) throw new Error("No account was shared by the wallet.");

      const { message, nonce } = await requestWalletNonce({
        data: { address, chainId: defaultChain.id },
      });
      const signature = (await provider.request({
        method: "personal_sign",
        params: [message, address],
      })) as string;

      await verifyWalletSignature({
        data: { address, chainId: defaultChain.id, nonce, message, signature },
      });
      await queryClient.invalidateQueries({ queryKey: ["my-wallets"] });
      toast.success("Wallet linked and verified.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Wallet linking failed.");
    } finally {
      setBusy(false);
    }
  }

  async function unlink(address: string) {
    setBusy(true);
    try {
      await unlinkWallet({ data: { address } });
      await queryClient.invalidateQueries({ queryKey: ["my-wallets"] });
      toast.success("Wallet unlinked.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not unlink that wallet.");
    } finally {
      setBusy(false);
    }
  }

  const linked = wallets.data ?? [];

  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <h2 className="text-lg font-bold">Wallet</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Linking proves you control an address. It grants no spending permission, and we never ask
        for a seed phrase. You'll sign a plain text message on {defaultChain.name}.
      </p>

      {linked.length > 0 ? (
        <ul className="mt-5 divide-y divide-border">
          {linked.map((wallet) => (
            <li key={wallet.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <p className="mono-chain text-sm font-semibold">{shortAddress(wallet.address)}</p>
                <p className="text-xs text-muted-foreground">
                  Verified {new Date(wallet.verified_at).toLocaleDateString("en-GB")} • chain{" "}
                  {wallet.chain_id}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <a
                  href={explorerAddressUrl(wallet.chain_id, wallet.address)}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-sm underline underline-offset-4"
                >
                  Explorer
                </a>
                <Button variant="outline" size="sm" disabled={busy} onClick={() => void unlink(wallet.address)}>
                  Unlink
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-5 text-sm text-muted-foreground">No wallet linked yet.</p>
      )}

      <Button className="mt-5" disabled={busy} onClick={() => void link()}>
        {busy ? "Waiting for wallet…" : linked.length > 0 ? "Link another wallet" : "Link a wallet"}
      </Button>
    </section>
  );
}
