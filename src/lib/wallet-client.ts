import { activeChain, chainById } from "@/lib/chain";

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

export async function currentChainId(): Promise<number | null> {
  const provider = injectedProvider();
  if (!provider) return null;
  const hex = (await provider.request({ method: "eth_chainId" })) as string;
  return hex ? Number.parseInt(hex, 16) : null;
}

/** Switches (or adds) the target Robinhood chain in the connected wallet. Defaults to the app's active chain. */
export async function ensureChain(chainId: number = activeChain.id): Promise<void> {
  const provider = requireProvider();
  const chain = chainById(chainId);
  const hexId = `0x${chain.id.toString(16)}`;
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
          chainName: chain.name,
          nativeCurrency: chain.nativeCurrency,
          rpcUrls: [...chain.rpcUrls.default.http],
          blockExplorerUrls: [chain.blockExplorers.default.url],
        },
      ],
    });
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
  }
  const after = (await provider.request({ method: "eth_chainId" })) as string;
  if (after?.toLowerCase() !== hexId) {
    throw new Error(`The wallet is still on chain ${Number.parseInt(after, 16)}. Switch to ${chain.name} (${chain.id}) and try again.`);
  }
}

export async function sendTransaction(input: {
  from: string;
  to: string;
  data: string;
  /** Hex-encoded wei, e.g. "0x2386f26fc10000". Omit for zero. */
  value?: string | null | undefined;
  /** Hex-encoded gas limit if you already estimated it. */
  gas?: string | null | undefined;
}): Promise<string> {
  const provider = requireProvider();
  const params: Record<string, string> = { from: input.from, to: input.to, data: input.data };
  if (input.value && input.value !== "0x0") params["value"] = input.value;
  if (input.gas) params["gas"] = input.gas;
  const hash = (await provider.request({ method: "eth_sendTransaction", params: [params] })) as string;
  if (!/^0x[a-fA-F0-9]{64}$/.test(hash)) throw new Error("The wallet did not return a transaction hash.");
  return hash;
}

export function toHexQuantity(value: bigint): string {
  return `0x${value.toString(16)}`;
}
