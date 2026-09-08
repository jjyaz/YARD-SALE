import { defaultChain } from "@/lib/chain";

export type Eip1193 = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

export function injectedProvider(): Eip1193 | null {
  return (globalThis as unknown as { ethereum?: Eip1193 }).ethereum ?? null;
}

export function requireProvider(): Eip1193 {
  const provider = injectedProvider();
  if (!provider) {
    throw new Error("No browser wallet found. Install an EVM wallet extension, then reload this page.");
  }
  return provider;
}

export async function connectAccount(): Promise<string> {
  const provider = requireProvider();
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  const address = accounts[0];
  if (!address) throw new Error("Your wallet did not share an account.");
  return address.toLowerCase();
}

/** Switches (or adds) the Robinhood testnet in the connected wallet. */
export async function ensureChain(): Promise<void> {
  const provider = requireProvider();
  const hexId = `0x${defaultChain.id.toString(16)}`;
  const current = (await provider.request({ method: "eth_chainId" })) as string;
  if (current?.toLowerCase() === hexId) return;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code !== 4902 && code !== -32603) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: hexId,
          chainName: defaultChain.name,
          nativeCurrency: defaultChain.nativeCurrency,
          rpcUrls: [...defaultChain.rpcUrls.default.http],
          blockExplorerUrls: [defaultChain.blockExplorers.default.url],
        },
      ],
    });
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
  }
}

export async function sendTransaction(input: { from: string; to: string; data: string }): Promise<string> {
  const provider = requireProvider();
  const hash = (await provider.request({
    method: "eth_sendTransaction",
    params: [{ from: input.from, to: input.to, data: input.data }],
  })) as string;
  if (!/^0x[a-fA-F0-9]{64}$/.test(hash)) throw new Error("The wallet did not return a transaction hash.");
  return hash;
}
