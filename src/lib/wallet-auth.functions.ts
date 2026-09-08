import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createHash, randomBytes } from "node:crypto";

const NONCE_TTL_MINUTES = 10;

function hashNonce(nonce: string): string {
  return createHash("sha256").update(nonce).digest("hex");
}

function requestDomain(): string {
  const request = getRequest();
  if (!request) throw new Error("Sign-in must start from an app request.");
  const url = new URL(request.url);
  const forwarded = url.hostname === "localhost" ? request.headers.get("x-forwarded-host") : null;
  return forwarded ?? url.host;
}

function buildSignInMessage(input: {
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
    "Sign in to YARD SALE. This signature costs nothing, sends no transaction and grants no spending permission.",
    "",
    `URI: https://${input.domain}`,
    "Version: 1",
    `Chain ID: ${input.chainId}`,
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAt}`,
  ].join("\n");
}

function walletEmail(address: string): string {
  return `${address}@wallet.yardsale.app`;
}

/** Public: issues a single-use, expiring sign-in challenge for a wallet address. */
export const requestSignInNonce = createServerFn({ method: "POST" })
  .inputValidator((input: { address: string; chainId: number }) => {
    if (!/^0x[a-fA-F0-9]{40}$/.test(input.address)) throw new Error("Invalid wallet address.");
    if (!Number.isInteger(input.chainId)) throw new Error("Invalid chain id.");
    return input;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const address = data.address.toLowerCase();
    const domain = requestDomain();
    const nonce = randomBytes(16).toString("hex");
    const issuedAt = new Date().toISOString();

    const { error } = await supabaseAdmin.from("wallet_nonces").insert({
      user_id: null,
      nonce_hash: hashNonce(nonce),
      address,
      domain,
      chain_id: data.chainId,
      expires_at: new Date(Date.now() + NONCE_TTL_MINUTES * 60_000).toISOString(),
    });
    if (error) throw new Error(error.message);

    return {
      message: buildSignInMessage({ domain, address, nonce, chainId: data.chainId, issuedAt }),
      nonce,
    };
  });

/**
 * Public: verifies the signed challenge, finds or creates the account bound to
 * that address, and returns a one-time token the browser exchanges for a session.
 */
export const verifyWalletSignIn = createServerFn({ method: "POST" })
  .inputValidator((input: {
    address: string;
    chainId: number;
    nonce: string;
    message: string;
    signature: string;
  }) => {
    if (!/^0x[a-fA-F0-9]{40}$/.test(input.address)) throw new Error("Invalid wallet address.");
    if (!/^0x[a-fA-F0-9]+$/.test(input.signature)) throw new Error("Invalid signature.");
    return input;
  })
  .handler(async ({ data }) => {
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
    if (!row) throw new Error("This sign-in request is no longer valid. Start again.");
    if (row.user_id) throw new Error("This request was not issued for sign-in.");
    if (row.consumed_at) throw new Error("This sign-in request has already been used.");
    if (new Date(row.expires_at).getTime() < Date.now()) throw new Error("This sign-in request expired.");
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

    const { data: wallet, error: walletError } = await supabaseAdmin
      .from("wallets")
      .select("user_id")
      .eq("address", address)
      .maybeSingle();
    if (walletError) throw new Error(walletError.message);

    const email = walletEmail(address);
    let userId = wallet?.user_id ?? null;

    if (!userId) {
      const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { wallet_address: address, chain_id: data.chainId },
      });
      if (createError || !created.user) {
        throw new Error(createError?.message ?? "Could not create an account for this wallet.");
      }
      userId = created.user.id;

      const { error: insertError } = await supabaseAdmin.from("wallets").insert({
        user_id: userId,
        address,
        chain_id: data.chainId,
        verified_at: new Date().toISOString(),
        last_used_at: new Date().toISOString(),
      });
      if (insertError) throw new Error(insertError.message);
    } else {
      await supabaseAdmin
        .from("wallets")
        .update({ last_used_at: new Date().toISOString() })
        .eq("address", address);
    }

    const { data: account } = await supabaseAdmin.auth.admin.getUserById(userId);
    const loginEmail = account?.user?.email ?? email;

    const { data: link, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: loginEmail,
    });
    if (linkError || !link.properties?.hashed_token) {
      throw new Error(linkError?.message ?? "Could not start a session for this wallet.");
    }

    return { tokenHash: link.properties.hashed_token, address };
  });
