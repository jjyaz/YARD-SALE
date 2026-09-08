import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createHash, randomBytes } from "node:crypto";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const NONCE_TTL_MINUTES = 10;

function hashNonce(nonce: string): string {
  return createHash("sha256").update(nonce).digest("hex");
}

function requestDomain(): string {
  const request = getRequest();
  if (!request) throw new Error("Wallet linking must start from an app request.");
  const url = new URL(request.url);
  const forwarded = url.hostname === "localhost" ? request.headers.get("x-forwarded-host") : null;
  return forwarded ?? url.host;
}

function buildMessage(input: {
  domain: string;
  address: string;
  nonce: string;
  chainId: number;
  issuedAt: string;
}) {
  return [
    `${input.domain} wants you to sign in with your Ethereum account:`,
    input.address,
    "",
    "Link this wallet to your YARD SALE account. This signature costs nothing and grants no spending permission.",
    "",
    `URI: https://${input.domain}`,
    "Version: 1",
    `Chain ID: ${input.chainId}`,
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAt}`,
  ].join("\n");
}

/** Issues a single-use, expiring nonce and the exact message the wallet must sign. */
export const requestWalletNonce = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { address: string; chainId: number }) => {
    if (!/^0x[a-fA-F0-9]{40}$/.test(input.address)) throw new Error("Invalid wallet address.");
    if (!Number.isInteger(input.chainId)) throw new Error("Invalid chain id.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const address = data.address.toLowerCase();
    const domain = requestDomain();
    const nonce = randomBytes(16).toString("hex");
    const issuedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + NONCE_TTL_MINUTES * 60_000).toISOString();

    const { error } = await supabaseAdmin.from("wallet_nonces").insert({
      user_id: context.userId,
      nonce_hash: hashNonce(nonce),
      address,
      domain,
      chain_id: data.chainId,
      expires_at: expiresAt,
    });
    if (error) throw new Error(error.message);

    return {
      message: buildMessage({ domain, address, nonce, chainId: data.chainId, issuedAt }),
      nonce,
      expiresAt,
    };
  });

/** Verifies the signed message server-side and binds the address to the account. */
export const verifyWalletSignature = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { address: string; chainId: number; nonce: string; message: string; signature: string }) => {
    if (!/^0x[a-fA-F0-9]{40}$/.test(input.address)) throw new Error("Invalid wallet address.");
    if (!/^0x[a-fA-F0-9]+$/.test(input.signature)) throw new Error("Invalid signature.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { verifyMessage } = await import("viem");
    const address = data.address.toLowerCase();
    const domain = requestDomain();
    const nonceHash = hashNonce(data.nonce);

    const { data: row, error: nonceError } = await supabaseAdmin
      .from("wallet_nonces")
      .select("id, user_id, address, domain, chain_id, expires_at, consumed_at")
      .eq("nonce_hash", nonceHash)
      .maybeSingle();
    if (nonceError) throw new Error(nonceError.message);
    if (!row) throw new Error("This link request is no longer valid. Start again.");
    if (row.consumed_at) throw new Error("This link request has already been used.");
    if (new Date(row.expires_at).getTime() < Date.now()) throw new Error("This link request expired.");
    if (row.user_id !== context.userId) throw new Error("This link request belongs to another account.");
    if ((row.address ?? "") !== address) throw new Error("Signed address does not match the request.");
    if (row.domain !== domain) throw new Error("Signature was issued for a different site.");
    if (row.chain_id !== data.chainId) throw new Error("Signature was issued for a different network.");
    if (!data.message.includes(data.nonce) || !data.message.includes(domain)) {
      throw new Error("Signed message does not match the request.");
    }

    const valid = await verifyMessage({
      address: address as `0x${string}`,
      message: data.message,
      signature: data.signature as `0x${string}`,
    });
    if (!valid) throw new Error("Signature could not be verified.");

    await supabaseAdmin
      .from("wallet_nonces")
      .update({ consumed_at: new Date().toISOString() })
      .eq("id", row.id);

    const { data: existing } = await supabaseAdmin
      .from("wallets")
      .select("id, user_id")
      .eq("address", address)
      .maybeSingle();
    if (existing && existing.user_id !== context.userId) {
      throw new Error("That wallet is already linked to another YARD SALE account.");
    }

    const { error: upsertError } = await supabaseAdmin.from("wallets").upsert(
      {
        user_id: context.userId,
        address,
        chain_id: data.chainId,
        verified_at: new Date().toISOString(),
      },
      { onConflict: "address" },
    );
    if (upsertError) throw new Error(upsertError.message);

    return { address, chainId: data.chainId };
  });

export const unlinkWallet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { address: string }) => input)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const address = data.address.toLowerCase();

    const { count } = await supabaseAdmin
      .from("listings")
      .select("id", { count: "exact", head: true })
      .eq("seller_id", context.userId)
      .eq("passport_minted", true);
    if ((count ?? 0) > 0) {
      throw new Error(
        "This wallet is attached to listings with a minted Item Passport and cannot be unlinked.",
      );
    }

    const { error } = await supabaseAdmin
      .from("wallets")
      .delete()
      .eq("user_id", context.userId)
      .eq("address", address);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
